import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, generateDataset } from '../src/core/sample';
import { analyzeDataset, filterRows, resolveQualification } from '../src/core/analysis';
import { EMPTY_SCOPE } from '../src/core/analysis';
import type { QualificationSnapshot } from '../src/types/domain';

const dataset = generateDataset(DEFAULT_CONFIG);
const analysis = analyzeDataset(dataset);

describe('金额核对：按结算行唯一计额', () => {
  it('支付金额合计等于结算行金额之和，与命中条数无关', () => {
    const rowSum = dataset.settlements.reduce((acc, row) => acc + row.paymentAmountCents, 0);
    expect(analysis.totals.paymentCents).toBe(rowSum);
  });

  it('同一结算行命中多条规则时，金额只计一次', () => {
    const multi = analysis.rows.filter((row) => row.hits.length >= 2);
    expect(multi.length).toBeGreaterThan(0);

    const singleCounted = multi.reduce((acc, item) => acc + item.row.paymentAmountCents, 0);
    const flattened = multi.reduce(
      (acc, item) => acc + item.row.paymentAmountCents * item.hits.length,
      0,
    );
    expect(flattened).toBeGreaterThan(singleCounted);
    expect(analysis.totals.duplicatedHintCents).toBe(
      analysis.rows.reduce(
        (acc, item) => acc + Math.max(0, item.hits.length - 1) * item.row.paymentAmountCents,
        0,
      ),
    );
  });

  it('每条命中带独立解释字段，但提示金额不累加到支付金额', () => {
    const sample = analysis.rows.find((row) => row.hits.length >= 2)!;
    for (const hit of sample.hits) {
      expect(hit.clause.length).toBeGreaterThan(0);
      expect(hit.finding.length).toBeGreaterThan(0);
      expect(hit.hintAmountCents).toBeGreaterThan(0);
    }
    const hintSum = sample.hits.reduce((acc, hit) => acc + hit.hintAmountCents, 0);
    expect(hintSum).not.toBe(sample.row.paymentAmountCents);
  });
});

describe('资质回查：重叠/空档不任选版本', () => {
  const findByKey = (institutionCode: string, itemCode: string) =>
    dataset.qualifications.filter(
      (snapshot) => snapshot.institutionCode === institutionCode && snapshot.checkItemCode === itemCode,
    );

  it('H007 胃肠镜在 2025-03-12 有两版重叠快照，标记待核且不选择主版本', () => {
    const analysisRow = analysis.byId['S-000001'];
    expect(analysisRow.row.serviceDate).toBe('2025-03-12');
    expect(analysisRow.qualification.status).toBe('overlap');
    expect(analysisRow.qualification.candidates.length).toBeGreaterThanOrEqual(2);
    expect(analysisRow.qualification.primary).toBeNull();
    expect(analysisRow.reviewState).toBe('待核');
  });

  it('H005 内固定在 2025-03-18 处于空档，标记待核', () => {
    const analysisRow = analysis.byId['S-000002'];
    expect(analysisRow.qualification.status).toBe('gap');
    expect(analysisRow.qualification.candidates).toHaveLength(0);
    expect(analysisRow.qualification.primary).toBeNull();
  });

  it('资质状态非有效时不视为可用资质', () => {
    const analysisRow = analysis.byId['S-000003'];
    expect(analysisRow.qualification.status).toBe('inactive');
    expect(analysisRow.qualification.primary?.state).toBe('注销');
  });

  it('快照解析不因当前状态改写历史：服务日只匹配区间内版本', () => {
    const snapshots: QualificationSnapshot[] = [
      {
        id: 'Q-X-1',
        institutionCode: 'H999',
        institutionName: '测试机构',
        checkItemCode: 'JC01',
        checkItemName: '磁共振平扫',
        certNo: 'C1',
        validFrom: '2025-01-01',
        validTo: '2025-02-28',
        state: '有效',
        revision: 1,
        sourceBatchId: 'B1',
        revisedAt: '2025-01-01',
        note: '',
      },
      {
        id: 'Q-X-2',
        institutionCode: 'H999',
        institutionName: '测试机构',
        checkItemCode: 'JC01',
        checkItemName: '磁共振平扫',
        certNo: 'C2',
        validFrom: '2025-03-01',
        validTo: null,
        state: '暂停',
        revision: 2,
        sourceBatchId: 'B1',
        revisedAt: '2025-03-01',
        note: '',
      },
    ];
    const historical = resolveQualification(snapshots, '2025-02-10');
    expect(historical.status).toBe('ok');
    expect(historical.primary?.id).toBe('Q-X-1');

    const later = resolveQualification(snapshots, '2025-04-10');
    expect(later.status).toBe('inactive');
    expect(later.primary?.id).toBe('Q-X-2');
  });

  it('更正快照通过 supersedes 取代旧版，同时保留旧版记录可回查', () => {
    const snapshots = findByKey('H007', 'JC06');
    const before = resolveQualification(snapshots, '2025-03-12');
    expect(before.status).toBe('overlap');

    const revision: QualificationSnapshot = {
      ...snapshots[0],
      id: 'Q-H007-JC06-C1',
      revision: 9,
      supersedes: snapshots.map((snapshot) => snapshot.id),
    };
    const after = resolveQualification([...snapshots, revision], '2025-03-12');
    expect(after.status).toBe('ok');
    expect(after.primary?.id).toBe('Q-H007-JC06-C1');
    expect(after.candidates.map((item) => item.id)).toContain(snapshots[0].id);
  });
});

describe('范围冻结与材料', () => {
  it('范围筛选按项目、统筹区、机构、规则与日期取交集', () => {
    const rows = filterRows(analysis, {
      ...EMPTY_SCOPE,
      itemCodes: ['JC06'],
      areaCodes: ['3201'],
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const item of rows) {
      expect(item.row.itemCode).toBe('JC06');
      expect(item.row.poolingAreaCode).toBe('3201');
    }
  });

  it('规则维度筛选只保留命中指定规则的行', () => {
    const rows = filterRows(analysis, { ...EMPTY_SCOPE, ruleCodes: ['R-201'] });
    expect(rows.length).toBeGreaterThan(0);
    for (const item of rows) {
      expect(item.hits.some((hit) => hit.ruleCode === 'R-201')).toBe(true);
    }
  });
});
