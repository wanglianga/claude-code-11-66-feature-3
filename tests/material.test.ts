import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { DEFAULT_CONFIG, generateDataset } from '../src/core/sample';
import { analyzeDataset, EMPTY_SCOPE } from '../src/core/analysis';
import { buildMaterial, diffMaterials, verifyMaterial } from '../src/core/material';
import { buildReviewBundle } from '../src/core/export';
import { buildOfflineViewerHtml } from '../src/core/offlineViewer';
import { digestOf, stableStringify } from '../src/core/hash';
import { applyConclusionCorrection, applyQualificationCorrection } from '../src/core/corrections';
import { buildConclusionCorrection, buildQualificationCorrection } from '../src/core/sample';
import type { MaterialPackage, ScopeFilter } from '../src/types/domain';

const dataset = generateDataset(DEFAULT_CONFIG);
const analysis = analyzeDataset(dataset);

function materialFor(scope: ScopeFilter, version = 1, extra: Partial<Parameters<typeof buildMaterial>[0]> = {}) {
  return buildMaterial({
    analysis,
    dataset,
    scope,
    version,
    basisPackageId: null,
    correction: null,
    createdBy: '测试',
    createdAt: `2025-08-0${version}T10:00:00+08:00`,
    ...extra,
  });
}

describe('材料生成与校验', () => {
  it('全量材料的金额与行主表一致，且校验项全部通过', () => {
    const material = materialFor(EMPTY_SCOPE);
    expect(material.rowCount).toBe(dataset.settlements.length);
    const rowsSum = material.rows.reduce((acc, row) => acc + row.paymentAmountCents, 0);
    expect(material.totals.paymentCents).toBe(rowsSum);
    expect(material.verification.passed).toBe(true);
    expect(material.verification.checks.every((check) => check.passed)).toBe(true);
  });

  it('多命中行在材料中只出现一次，但引用全部命中证据', () => {
    const material = materialFor(EMPTY_SCOPE);
    const ids = material.rows.map((row) => row.settlementId);
    expect(new Set(ids).size).toBe(ids.length);

    const multi = material.rows.filter((row) => row.hitIds.length >= 2);
    expect(multi.length).toBeGreaterThan(0);
    for (const row of multi) {
      expect(material.evidence.hits.filter((hit) => row.hitIds.includes(hit.id))).toHaveLength(row.hitIds.length);
    }
    expect(material.totals.dedupeSavedCents).toBeGreaterThan(0);
  });

  it('待核行在材料中不指定唯一资质版本', () => {
    const material = materialFor(EMPTY_SCOPE);
    const pending = material.rows.filter((row) => row.qualificationStatus === 'gap' || row.qualificationStatus === 'overlap');
    expect(pending.length).toBeGreaterThan(0);
    for (const row of pending) {
      expect(row.primaryQualificationId).toBeNull();
    }
  });

  it('证据引用全部可回查，没有悬空引用', () => {
    const material = materialFor(EMPTY_SCOPE);
    const hitIds = new Set(material.evidence.hits.map((hit) => hit.id));
    const qualIds = new Set(material.evidence.qualifications.map((item) => item.id));
    const conIds = new Set(material.evidence.conclusions.map((item) => item.id));
    for (const row of material.rows) {
      for (const id of row.hitIds) expect(hitIds.has(id)).toBe(true);
      for (const id of row.qualificationCandidateIds) expect(qualIds.has(id)).toBe(true);
      if (row.conclusionId) expect(conIds.has(row.conclusionId)).toBe(true);
    }
  });

  it('范围冻结只纳入范围内行，且金额为子集', () => {
    const scope: ScopeFilter = { ...EMPTY_SCOPE, itemCodes: ['JC06'], areaCodes: ['3201'] };
    const material = materialFor(scope);
    expect(material.rowCount).toBeGreaterThan(0);
    expect(material.rowCount).toBeLessThanOrEqual(dataset.settlements.length);
    expect(material.rows.every((row) => row.itemCode === 'JC06' && row.areaCode === '3201')).toBe(true);
    expect(material.totals.paymentCents).toBeLessThanOrEqual(analysis.totals.paymentCents);
  });

  it('内容摘要随范围变化，可区分不同材料', () => {
    const a = materialFor(EMPTY_SCOPE);
    const b = materialFor({ ...EMPTY_SCOPE, onlyPending: true });
    expect(a.verification.contentDigest).not.toBe(b.verification.contentDigest);
    expect(a.scopeHash).not.toBe(b.scopeHash);
  });

  it('篡改材料行金额会被逐行核对发现', () => {
    const material = materialFor(EMPTY_SCOPE);
    const tampered: MaterialPackage = {
      ...material,
      rows: material.rows.map((row, index) =>
        index === 3 ? { ...row, paymentAmountCents: row.paymentAmountCents + 1 } : row,
      ),
    };
    const result = verifyMaterial({
      ...tampered,
      contentDigest: digestOf({ ...tampered, verification: undefined }),
      checks: [],
    });
    expect(result.passed).toBe(false);
    expect(result.checks.find((check) => check.id === 'amount-unique')?.passed).toBe(false);
  });
});

describe('离线材料包', () => {
  it('ZIP 包含离线审阅器、主表、证据、清单与校验文件', () => {
    const material = materialFor(EMPTY_SCOPE);
    const bundle = buildReviewBundle(material);
    expect(bundle.fileName.endsWith('.zip')).toBe(true);
    expect(bundle.entries).toEqual(
      expect.arrayContaining([
        'index.html',
        'material.json',
        'rows.json',
        'manifest.json',
        'verification.json',
        'evidence/rule-hits.json',
        'evidence/qualifications.json',
        'evidence/conclusions.json',
        'sources.json',
        'README.txt',
      ]),
    );
  });

  it('离线 index.html 内嵌材料数据且不引用外部脚本', () => {
    const material = materialFor(EMPTY_SCOPE, 1);
    const html = buildOfflineViewerHtml(material);
    expect(html).toContain(material.id);
    expect(html).toContain('const MATERIAL =');
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).toContain(material.rows[0].settlementId);
  });

  it('ZIP 内 material.json 与内存材料一致（可离线打开复核）', async () => {
    const material = materialFor(EMPTY_SCOPE);
    const bundle = buildReviewBundle(material);
    const bytes = new Uint8Array(await bundle.blob.arrayBuffer());
    const entries = unzipSync(bytes);
    const parsed = JSON.parse(strFromU8(entries['material.json'])) as MaterialPackage;
    expect(parsed.id).toBe(material.id);
    expect(parsed.verification.contentDigest).toBe(material.verification.contentDigest);
    expect(parsed.totals.paymentCents).toBe(material.totals.paymentCents);
    expect(parsed.rows.length).toBe(material.rows.length);
  });
});

describe('更正前后差异', () => {
  it('结论更正只影响指定行；已封存材料的行内容不变', () => {
    const base = materialFor(EMPTY_SCOPE);
    const frozenBefore = stableStringify(base.rows);

    const correction = buildConclusionCorrection(dataset);
    const applied = applyConclusionCorrection(dataset, correction);
    const nextAnalysis = analyzeDataset(applied.dataset);
    const next = buildMaterial({
      analysis: nextAnalysis,
      dataset: applied.dataset,
      scope: EMPTY_SCOPE,
      version: 2,
      basisPackageId: base.id,
      correction: {
        reason: '结论更正',
        batchIds: [correction.batch.id],
        affectedRowIds: correction.affectedSettlementIds,
        appliedAt: '2025-08-06T14:20:00+08:00',
        sourceVersion: correction.sourceVersion,
      },
      createdBy: '测试',
      createdAt: '2025-08-06T14:20:00+08:00',
      title: '更正版',
    });

    // 已封存材料对象未被就地修改
    expect(stableStringify(base.rows)).toBe(frozenBefore);
    expect(base.rows.every((row) => row.paymentAmountCents > 0)).toBe(true);

    const diff = diffMaterials(base, next);
    expect(diff.changedRows.length).toBeGreaterThan(0);
    expect(diff.changedRows.every((row) => correction.affectedSettlementIds.includes(row.settlementId))).toBe(true);
    expect(next.correction?.affectedRowIds.sort()).toEqual([...correction.affectedSettlementIds].sort());
    expect(next.basisPackageId).toBe(base.id);
    expect(next.verification.passed).toBe(true);
  });

  it('资质补正使重叠/空档行转为有效，且旧快照仍保留供回查', () => {
    const correction = buildQualificationCorrection(dataset);
    const applied = applyQualificationCorrection(dataset, correction);
    const nextAnalysis = analyzeDataset(applied.dataset);

    const before = analysis.byId['S-000001'];
    const after = nextAnalysis.byId['S-000001'];
    expect(before.qualification.status).toBe('overlap');
    expect(after.qualification.status).toBe('ok');
    expect(after.qualification.primary?.id).toBe('Q-H007-JC06-C1');

    const beforeGap = analysis.byId['S-000002'];
    const afterGap = nextAnalysis.byId['S-000002'];
    expect(beforeGap.qualification.status).toBe('gap');
    expect(afterGap.qualification.status).toBe('ok');

    // 旧快照没有删除，仍可回查
    const ids = new Set(applied.dataset.qualifications.map((item) => item.id));
    expect(ids.has('Q-H007-JC06-01')).toBe(true);
    expect(ids.has('Q-H007-JC06-02')).toBe(true);
    expect(ids.has('Q-H005-JC08-01')).toBe(true);
  });

  it('更正后新材料带来源批次，且金额差额仅来自行级变化', () => {
    const base = materialFor(EMPTY_SCOPE);
    const correction = buildQualificationCorrection(dataset);
    const applied = applyQualificationCorrection(dataset, correction);
    const next = buildMaterial({
      analysis: analyzeDataset(applied.dataset),
      dataset: applied.dataset,
      scope: EMPTY_SCOPE,
      version: 2,
      basisPackageId: base.id,
      correction: {
        reason: '资质补正',
        batchIds: [correction.batch.id],
        affectedRowIds: correction.affectedSettlementIds,
        appliedAt: '2025-08-06T14:35:00+08:00',
        sourceVersion: correction.sourceVersion,
      },
      createdBy: '测试',
      createdAt: '2025-08-06T14:35:00+08:00',
    });

    const diff = diffMaterials(base, next);
    // 资质更正不改支付金额，因此金额差额为 0
    expect(diff.amountDeltaCents).toBe(0);
    expect(diff.changedRows.every((row) => row.changedFields.includes('资质依据'))).toBe(true);
    expect(next.totals.paymentCents).toBe(base.totals.paymentCents);
  });
});

describe('更正幂等性', () => {
  it('同一资质更正重复应用不会产生重复快照或新的重叠', () => {
    const correction = buildQualificationCorrection(dataset);
    const once = applyQualificationCorrection(dataset, correction);
    const twice = applyQualificationCorrection(once.dataset, correction);
    const after = analyzeDataset(twice.dataset).byId['S-000001'];
    expect(after.qualification.status).toBe('ok');
    expect(after.qualification.primary?.id).toBe('Q-H007-JC06-C1');
    const ids = twice.dataset.qualifications.map((item) => item.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('同一结论更正重复应用保留单条最新版本', () => {
    const correction = buildConclusionCorrection(dataset);
    const once = applyConclusionCorrection(dataset, correction);
    const twice = applyConclusionCorrection(once.dataset, correction);
    const ids = twice.dataset.conclusions.map((item) => item.id);
    expect(ids.length).toBe(new Set(ids).size);
    const latest = analyzeDataset(twice.dataset).byId['S-000006'].conclusion;
    expect(latest?.code).toBe('违规');
    expect(latest?.version).toBe(2);
  });
});
