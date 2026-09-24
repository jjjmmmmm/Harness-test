/* selftest.mjs — 用真存档自查解析器：node selftest.mjs
 * 只读 ../runs 与 ../results.jsonl，不写任何文件。全部断言通过才算解析可信。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DP = require('./parse.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const runsDir = path.join(root, 'runs');

let pass = 0, fail = 0;
const ok = (cond, msg, extra) => {
  if (cond) { pass++; }
  else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};

/* 1. sha256 标准向量 */
ok(DP.sha256(new TextEncoder().encode('abc')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256("abc")');
ok(DP.sha256(new Uint8Array(0)) === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'sha256("")');
ok(DP.sha256(new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')) === '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1', 'sha256(多块输入)');

/* 2. 全量读入 */
const dirs = fs.readdirSync(runsDir).filter((d) => d.startsWith('run-')).sort();
ok(dirs.length === 128, 'runs 目录下应有 128 个 run，实得 ' + dirs.length);

const runs = [];
for (const d of dirs) {
  const full = path.join(runsDir, d);
  const files = {};
  for (const fn of fs.readdirSync(full)) {
    const p = path.join(full, fn);
    if (fs.statSync(p).isFile()) files[fn] = new Uint8Array(fs.readFileSync(p));
  }
  runs.push(DP.buildRun(d, files));
}

const jsonl = fs.readFileSync(path.join(root, 'results.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const batch = DP.buildBatch(runs, { jsonlRows: jsonl });

/* 3. 目录名 ↔ trace 头行 ↔ jsonl 三方一致 */
const nameRe = /^run-(\d+)__([^_]+)__([AB])__(T\d+)__r(\d+)$/;
let badParse = 0, badCross = 0;
const rowsBySeq = new Map(jsonl.map((r) => [r.seq, r]));
for (const r of runs) {
  const m = nameRe.exec(r.key);
  if (!m) { badParse++; console.log('  ✗ 目录名不符: ' + r.key); continue; }
  const same = r.seq === +m[1] && r.mtag === m[2] && r.group === m[3] && r.task === m[4] && r.repeat === +m[5];
  if (!same) { badParse++; console.log('  ✗ trace 头行与目录名不一致: ' + r.key, [r.seq, r.mtag, r.group, r.task, r.repeat]); }
  const row = rowsBySeq.get(r.seq);
  if (!row || row.mtag !== r.mtag || row.group !== r.group || row.task !== r.task || row.repeat !== r.repeat) badCross++;
  if (row && row.judge !== r.judge) { console.log('  ✗ 判分理由不一致 seq=' + r.seq, [row.judge, r.judge]); badCross++; }
  if (row && row.passed !== r.passed) { console.log('  ✗ 判分结论不一致 seq=' + r.seq); badCross++; }
  if (row && row.artifact !== null && r.artifact) {
    const t = DP.decodeText(r.artifact.bytes).text;
    // 存档侧 jsonl 记的是模型交出的字符串（LF），磁盘上的文件是 python 文本模式写入（CRLF）；比对时归一化行尾
    if (t.replace(/\r\n/g, '\n') !== row.artifact) { console.log('  ✗ result.txt 与 jsonl.artifact 不一致 seq=' + r.seq); badCross++; }
  }
  // 头部「步数」与 jsonl 对齐；trace 里实际记下的步骤行数可能少（run-113/115 缺 step 2，见下方断言）
  if (row && row.n_steps !== r.nSteps) { console.log(`  ✗ 头部步数与 jsonl 不一致 seq=${r.seq} jsonl=${row.n_steps} trace头=${r.nSteps}`); badCross++; }
  if (row && r.steps.length > r.nSteps) { console.log(`  ✗ trace 步骤行数多于头部步数 seq=${r.seq}`); badCross++; }
  if (row && row.tokens !== r.tokens) { console.log(`  ✗ token 不一致 seq=${r.seq}`); badCross++; }
  if (row && Math.abs(row.elapsed_s - r.elapsedS) > 0.05) { console.log(`  ✗ 用时不一致 seq=${r.seq}`); badCross++; }
  // jsonl 的 final 是前 200 字符的节选，trace.log 里的才是全文
  if (row && !(r.final === row.final || (row.final.length <= 200 && r.final.startsWith(row.final)))) {
    console.log(`  ✗ 最终答复不一致 seq=${r.seq}`, JSON.stringify(row.final?.slice(0, 40)), JSON.stringify(r.final.slice(0, 40))); badCross++;
  }
  if (row && row.final && row.final.length > 200) { console.log(`  ✗ jsonl.final 超过 200 字符 seq=${r.seq}`); badCross++; }
}
ok(badParse === 0, 'trace 头行与目录名全部一致（128）');
ok(badCross === 0, '与 results.jsonl 的 8 个字段逐个一致（128×8，行尾与 200 字符节选已归一化）');

/* 3.5 产物行尾：run_python 文本模式写入 → CRLF；write_file 直写 → LF */
const crlfArt = runs.filter((r) => r.artifact && r.artifact.crlf).length;
const lfArt = runs.filter((r) => r.artifact && !r.artifact.crlf).length;
ok(crlfArt + lfArt === 106, '有产物的 run 共 106 个', [crlfArt, lfArt]);
ok(crlfArt > 0 && lfArt > 0, `产物行尾两种都有：CRLF ${crlfArt} / LF ${lfArt}`);
ok(runs.filter((r) => r.files.some((f) => f.kind === 'initial' && f.crlf)).length === 0, '初始文件全部为 LF（逐字节闸门的前提）');

/* 4. 汇总数字与 sum.md 对得上 */
ok(batch.stats.total === 128, '总数 128', batch.stats.total);
ok(batch.stats.passed === 97, '通过 97', batch.stats.passed);
ok(batch.stats.failed === 31, '失败 31（sum.md ⑤ 的 31 条失败清单）', batch.stats.failed);
ok(batch.stats.noArtifact === 22, '未产出 result.txt 的 22 个', batch.stats.noArtifact);
ok(batch.stats.models.join(',') === 'DS,ST', '两个模型轴', batch.stats.models);
ok(batch.stats.tasks.join(',') === 'T1,T2,T3,T4,T5,T6,T7,T8', '八个题', batch.stats.tasks);

/* 5. 机械体检的已知真值 */
const extraSeqs = batch.checks.extras.map((e) => e.seq).sort((a, b) => a - b);
ok(JSON.stringify(extraSeqs) === JSON.stringify([86, 87]), '异常新增文件只出现在 run-086/087', extraSeqs);
ok(batch.checks.extras.every((e) => e.name === 'numbers.txt'), '异常文件都是 numbers.txt');
ok(JSON.stringify(batch.checks.toolAnomalies.map((t) => t.seq).sort((a, b) => a - b)) === JSON.stringify([31, 31, 31, 31, 32]), '工具空参调用只在 run-031(×4)/run-032(×1)', batch.checks.toolAnomalies);
ok(batch.checks.judgeDisk.length === 0, '没有“判分与磁盘矛盾”的 run', batch.checks.judgeDisk);
ok(batch.checks.jsonl.mismatches.length === 0, 'results.jsonl 与目录无任何字段冲突');
ok(Object.keys(batch.checks.files).length === 0, '同题标准件逐字节全部一致（16×8 组）', Object.keys(batch.checks.files));
ok(batch.checks.missingFiles.length === 0, '没有缺标准件的 run', batch.checks.missingFiles);
ok(JSON.stringify(batch.checks.stepGaps.map((g) => [g.seq, g.missing.join()])) === JSON.stringify([[113, '2'], [115, '2']]),
  '步骤记录缺口只在 run-113/115（trace.log 丢了 step 2，头部仍记 4/6 步）', batch.checks.stepGaps);

/* 6. 用具名样本反查几处细节 */
const byKey = (n) => runs.find((r) => r.key.startsWith(`run-0${n}__`) || r.key.startsWith(`run-${n}__`));
const r47 = runs.find((r) => r.seq === 47);
ok(r47 && r47.steps.length === 9 && r47.tokens === 296082 && Math.abs(r47.elapsedS - 116.1) < 0.05, 'run-047 的 9 步 / 296082 token / 116.1s');
ok(r47 && r47.steps[0].error && /Error: failed/.test(r47.steps[0].output), 'run-047 step 0 报 Error: failed（截断生效）', r47 && r47.steps[0].output);
ok(r47 && r47.steps.filter((s) => /os\.walk/.test(s.args?.code || '')).length >= 3, 'run-047 多次 os.walk 扫盘');
ok(r47 && r47.steps[8].args.code.includes('equivalent.txt'), 'run-047 最后用 equivalent.txt 落盘');

const r87 = runs.find((r) => r.seq === 87);
ok(r87 && r87.files.some((f) => f.name === 'numbers.txt' && f.kind === 'extra'), 'run-087 自建了 numbers.txt（被判为异常文件）');
ok(r87 && r87.writeAttempts >= 2, 'run-087 有写入动作（write_file 被拒后走 run_python）', r87 && r87.writeAttempts);
ok(r87 && r87.files.find((f) => f.name === 'result.txt').size === 2, 'run-087 产物是 2 字节（30）');

const r83 = runs.find((r) => r.seq === 83);
ok(r83 && r83.judge === '词=orange✓ 次数=5✗', 'run-083 判分理由「词=orange✓ 次数=5✗」', r83 && r83.judge);
ok(r83 && DP.decodeText(r83.artifact.bytes).text.replace(/\r\n/g, '\n') === 'orange\n', 'run-083 产物只有词、没有次数 → 判 ✗ 的来由可查');
ok(r83 && r83.fileStats.summary['badbytes.txt'].total === 16 && r83.fileStats.summary['badbytes.txt'].variants.length === 0, 'run-083 的初始文件与同题 15 个 run 逐字节一致（排除“被改动”这一可能）');

const r31 = runs.find((r) => r.seq === 31);
ok(r31 && r31.steps[0].argsMissing && /KeyError/.test(r31.steps[0].output), 'run-031 step 0 = run_python(None) → KeyError');

const r117 = runs.find((r) => r.seq === 117);
ok(r117 && r117.steps.some((s) => /numbers_backup\.txt/.test(s.args?.path || '')), 'run-117 走了备份文件（截断下的 T6 对照）');
ok(r117 && r117.files.find((f) => f.name === 'numbers_backup.txt').kind === 'initial', 'run-117 的备份文件是标准件（不是它新建的）');

const r86 = runs.find((r) => r.seq === 86);
ok(r86 && r86.files.find((f) => f.name === 'numbers.txt').kind === 'extra' && !r86.files.find((f) => f.name === 'numbers.txt').crlf, 'run-086 自建 numbers.txt（LF 行尾 → 出自 run_python 直写）');
ok(r87 && r87.files.find((f) => f.name === 'numbers.txt').crlf, 'run-087 自建 numbers.txt（CRLF 行尾 → 出自 python 文本模式 open(w)）');

/* 7. 输出截断的客观事实（用于界面上的诚实说明） */
let cap60 = 0;
for (const r of runs) for (const s of r.steps) {
  const first = (s.output || '').split('\n')[0];
  if (first.length === 60) cap60++;
}
ok(cap60 > 100, `trace.log 里 60 字符被截断的步骤输出有 ${cap60} 处（界面须注明输出为截断快照）`);

/* 8. 无输出/空产物边界 */
ok(runs.every((r) => r.markers), '128 个 trace 都含「步骤轨迹 / 最终答复」两段标记');
ok(runs.every((r) => typeof r.judge === 'string' && r.judge.length > 0), '128 个 run 都有判分理由');
ok(runs.every((r) => r.final.length > 0), '128 个 run 都有最终答复');

console.log(`\n${fail === 0 ? '全部通过' : '有失败'}：${pass} 项通过，${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
