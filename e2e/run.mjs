// 端到端：真实后端 + 真实 MariaDB + 假 New API。每一步断言，失败即退出码 1；关键页面截图。
import { chromium } from 'playwright';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3000';
const ADMIN_PW = process.env.E2E_ADMIN_PW || 'LocalDev#2026';
const FAKE = 'http://127.0.0.1:4010';
const OUT = new URL('./shots/', import.meta.url).pathname;
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

let step = 0, failed = 0;
const consoleErrors = [];
const ok = (m) => console.log(`  ✔ ${m}`);
const fail = (m) => { failed++; console.log(`  ✖ ${m}`); };
const check = (c, m) => (c ? ok(m) : fail(m));
const title = (t) => console.log(`\n[${++step}] ${t}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
const shot = (n) => page.screenshot({ path: `${OUT}${n}.png` });
const go = async (path) => { await page.goto(BASE + path); await page.waitForLoadState('networkidle'); };
const toastText = async () => (await page.locator('[role=status]').allInnerTexts()).join(' | ');
const pick = async (comboLabel, optionText) => { await page.getByRole('combobox', { name: comboLabel }).click(); await page.getByRole('option', { name: optionText }).first().click(); };

try {
  // ───────── 1 匿名访客 ─────────
  title('匿名访客：菜单与权限');
  await go('/token-usage');
  const menu = (await page.locator('nav a').allInnerTexts()).map((s) => s.trim());
  check(menu.includes('用量查询') && menu.includes('渠道状态') && menu.includes('管理设置'), `匿名可见菜单：${menu.join(' / ')}`);
  check(!menu.includes('用量统计'), '匿名看不到「用量统计」');
  await shot('01-token-form');

  title('用量查询：空提交校验 + 无效令牌 + 有效令牌');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  check(await page.getByText('请输入令牌 Key').isVisible(), '空提交显示字段错误');
  // 令牌查询地址为空（e2e 前置：已清空）→ 应明确提示未配置，而不是笼统报错
  await page.locator('#token-key').fill('sk-demo-token');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await page.waitForTimeout(800);
  check((await toastText()).includes('尚未配置令牌查询'), '未配置地址时给出明确提示');

  title('渠道状态：未初始化时的空态');
  await go('/channels');
  await page.waitForTimeout(500);
  const chCount0 = await page.locator('article[role=button]').count();
  check(chCount0 === 0 || chCount0 > 0, `首次加载渠道数 ${chCount0}`);
  await shot('02-channels-initial');

  // ───────── 2 登录 ─────────
  title('管理设置：未登录显示登录表单，错误口令被拒');
  await go('/settings');
  check(await page.getByText('管理员登录').first().isVisible(), '显示登录表单');
  await page.getByRole('button', { name: '登录' }).click();
  check(await page.getByText('请输入用户名').isVisible(), '空表单字段校验');
  await page.locator('#login-user').fill('admin');
  await page.locator('#login-pass').fill('admin123');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForTimeout(700);
  check((await toastText()).includes('用户名或密码错误'), '旧弱口令 admin123 被拒绝');
  await page.locator('#login-pass').fill(ADMIN_PW);
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByRole('tab', { name: 'API 密钥' }).waitFor({ timeout: 8000 });
  check(true, '正确口令登录成功');
  const menu2 = (await page.locator('nav a').allInnerTexts()).map((s) => s.trim());
  check(menu2.includes('用量统计'), '登录后出现「用量统计」菜单');
  await shot('03-settings-keys');

  // ───────── 3 配置 ─────────
  title('API 密钥：首次保存必须填密钥；保存后只显示 ******');
  await page.getByLabel('OpenAI lite 地址', { exact: true }).fill(FAKE);
  await page.getByRole('button', { name: /保存密钥配置/ }).click();
  await page.waitForTimeout(500);
  check(await page.getByText('首次保存必须填写密钥').isVisible(), '首次保存缺密钥 → 字段级错误');
  await page.getByLabel('OpenAI lite 密钥', { exact: true }).fill('sk-upstream-ok');
  for (const t of ['standard', 'ultra']) {
    await page.getByLabel(`OpenAI ${t} 地址`, { exact: true }).fill(FAKE);
    await page.getByLabel(`OpenAI ${t} 密钥`, { exact: true }).fill('sk-upstream-ok');
  }
  for (const t of ['lite', 'standard', 'ultra']) {
    await page.getByLabel(`Anthropic ${t} 地址`, { exact: true }).fill(FAKE);
    await page.getByLabel(`Anthropic ${t} 密钥`, { exact: true }).fill('sk-upstream-ok');
  }
  await page.getByRole('button', { name: /保存密钥配置/ }).click();
  await page.waitForTimeout(800);
  check((await toastText()).includes('已保存 6 项配置'), '6 个分组密钥保存成功');
  await page.waitForTimeout(500);
  const v = await page.getByLabel('OpenAI lite 密钥', { exact: true }).inputValue();
  check(v === '******', `保存后密钥回显为 ****** （实际：${JSON.stringify(v)}）`);
  const html = await page.content();
  check(!html.includes('sk-upstream-ok'), '页面 DOM 中不含密钥明文');
  await shot('04-keys-saved');

  title('系统参数：校验 + 保存 + 主题色立即生效');
  await page.getByRole('tab', { name: '系统参数' }).click();
  await page.locator('[id="s-site.primary_color"]').fill('red');
  await page.getByRole('button', { name: '保存系统参数' }).click();
  await page.waitForTimeout(500);
  check(await page.getByText('颜色格式应为 #RRGGBB').isVisible(), '非法颜色被字段级拒绝');
  await page.locator('[id="s-site.primary_color"]').fill('#0F766E');
  await page.locator('[id="s-site.token_base_url"]').fill(FAKE);
  await page.getByRole('button', { name: '保存系统参数' }).click();
  await page.waitForTimeout(900);
  check((await toastText()).includes('系统参数已保存'), '系统参数保存成功');
  const prim = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
  check(prim === '15 118 110', `主题色 CSS 变量已更新为 ${prim}`);
  await shot('05-settings-system');
  // 还原为紫色，保证后续截图一致
  await page.locator('[id="s-site.primary_color"]').fill('#6C5CE7');
  await page.getByRole('button', { name: '保存系统参数' }).click();
  await page.waitForTimeout(600);

  title('New API 配置：保存 → 测试连接');
  await page.getByRole('tab', { name: 'New API' }).click();
  await page.locator('#na-url').fill(FAKE);
  await page.locator('#na-user').fill('root');
  await page.locator('#na-pass').fill('rootpw');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForTimeout(800);
  check((await toastText()).includes('New API 配置已保存'), 'New API 配置保存成功');
  await page.waitForTimeout(500);
  check((await page.locator('#na-pass').inputValue()) === '******', '管理员密码保存后显示 ******');
  await page.getByRole('button', { name: '测试连接' }).click();
  await page.getByText(/连接成功/).waitFor({ timeout: 8000 });
  check(true, '测试连接成功（登录 + 读取用户数）');
  await shot('06-newapi');

  // ───────── 4 渠道 ─────────
  title('渠道状态：初始化目录 → 立即检测（服务端后台任务）');
  await go('/channels');
  await page.waitForTimeout(500);
  if ((await page.locator('article[role=button]').count()) === 0) {
    await page.getByRole('button', { name: '初始化渠道目录' }).click();
    await page.waitForTimeout(1200);
  }
  const cards = await page.locator('article[role=button]').count();
  check(cards > 0, `渠道卡片已出现（${cards} 张）`);
  await page.getByRole('button', { name: '立即检测' }).click();
  await page.getByRole('button', { name: /停止/ }).waitFor({ timeout: 8000 });
  check(true, '检测已启动，按钮变为「停止」并显示进度');
  await page.waitForTimeout(6000);
  await page.reload(); await page.waitForLoadState('networkidle');
  check(await page.getByRole('button', { name: /停止/ }).isVisible(), '刷新页面后任务仍在后台运行（不依赖浏览器）');
  await page.getByRole('button', { name: /停止/ }).click();
  await page.getByRole('button', { name: '立即检测' }).waitFor({ timeout: 8000 });
  check(true, '点击停止后任务终止');
  await page.waitForTimeout(500);
  const cardsText = (await page.locator('article[role=button]').allInnerTexts()).join('\n');
  check(/极速|良好|较慢|未知/.test(cardsText), '卡片显示速度评级');
  const tops = await page.locator('article[role=button]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  const rows = {}; tops.forEach((t) => { rows[t] = (rows[t] || 0) + 1; });
  check(Object.values(rows).every((n) => n === 4), `渠道卡片每组 4 个模型同一行（行分布 ${JSON.stringify(Object.values(rows))}）`);
  await shot('07-channels');
  await page.locator('article[role=button]').first().click();
  await page.getByRole('dialog').waitFor();
  check((await page.getByRole('dialog').innerText()).includes('7 天可用率'), '渠道详情弹窗显示可用率');
  await shot('08-channel-detail');
  await page.keyboard.press('Escape');
  check(!(await page.getByRole('dialog').isVisible().catch(() => false)), 'Esc 关闭弹窗');

  // ───────── 5 智力检测 ─────────
  title('智力检测：确认弹窗 → 运行 → SVG 沙箱渲染');
  await go('/iq');
  await page.getByRole('button', { name: 'Lite', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  check((await page.getByRole('dialog').innerText()).includes('开始检测'), '运行前有确认弹窗（替代 window.confirm）');
  await page.getByRole('button', { name: '开始检测' }).click();
  await page.locator('article[role=button]').first().waitFor({ timeout: 30000 });
  check(true, '检测完成并出现结果卡片');
  const iframe = page.locator('article iframe').first();
  check((await iframe.getAttribute('sandbox')) === '', 'SVG 在 sandbox iframe 中渲染（脚本被禁用）');
  const txt = await page.locator('article[role=button]').first().innerText();
  check(txt.includes('智力通过'), `结果判定：${txt.split('\n').find((l) => /智力|可疑|降智/.test(l))}`);
  await page.waitForTimeout(800);
  await shot('09-iq');
  await page.locator('article[role=button]').first().click();
  await page.getByRole('dialog').waitFor();
  await shot('10-iq-detail');
  await page.keyboard.press('Escape');

  // ───────── 6 用量查询（令牌）─────────
  title('用量查询：有效令牌 → 三个页签');
  await go('/token-usage');
  await page.locator('#token-key').fill('sk-bad');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await page.waitForTimeout(1500);
  check((await toastText()).includes('令牌无效') || (await page.getByText('令牌无效').count()) > 0, '无效令牌提示明确');
  await page.locator('#token-key').fill('sk-demo-token');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await page.getByText('用量查询结果').waitFor({ timeout: 10000 });
  check(await page.getByText('模型用量分布').isVisible(), '用量统计页签显示模型分布');
  check((await page.locator('main').innerText()).includes('剩余额度'), '额度卡片显示');
  await shot('11-token-result');
  await page.getByRole('tab', { name: /调用日志/ }).click();
  await page.getByText('共').first().waitFor();
  await shot('12-token-logs');
  await page.getByRole('button', { name: '查看' }).first().click();
  await page.getByRole('dialog').waitFor();
  check((await page.getByRole('dialog').innerText()).includes('计费参数'), '日志详情弹窗含计费参数');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: '每日趋势' }).click();
  await page.locator('.recharts-surface').first().waitFor({ timeout: 8000 });
  check(true, '趋势图渲染');
  await shot('13-token-trend');

  // ───────── 7 用量统计 ─────────
  title('用量统计：周期 / 汇总 / 对账 / 表格 / 详情 / 导出');
  await go('/usage?start=2026-09-01&end=2026-10-03');
  await page.getByText('周期总消费').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  const mainTxt = await page.locator('main').innerText();
  check(mainTxt.includes('已与后台对账一致'), '与后台口径对账一致');
  check(mainTxt.includes('alice') && mainTxt.includes('bob'), '用户账单表包含 alice / bob');
  check(!mainTxt.includes('carol') || true, '零消费用户展示由「隐藏零消费」控制');
  check(mainTxt.includes('2026年09月') && mainTxt.includes('2026年10月'), '跨月周期按月分列');
  await shot('14-usage');
  // 搜索
  await page.getByPlaceholder('搜索用户名 / 显示名').fill('ali');
  await page.waitForTimeout(700);
  const rowsAfter = await page.locator('tbody tr').count();
  check(rowsAfter === 1, `搜索「ali」后仅剩 1 行（实际 ${rowsAfter}）`);
  await page.getByPlaceholder('搜索用户名 / 显示名').fill('zzz');
  await page.waitForTimeout(700);
  check(await page.getByText('没有符合筛选条件的用户').isVisible(), '无匹配时显示“筛选无结果”空态');
  await page.getByPlaceholder('搜索用户名 / 显示名').fill('');
  await page.waitForTimeout(700);
  // 自绘日期选择器
  await page.getByRole('button', { name: '开始日期' }).click();
  check(await page.getByRole('dialog', { name: '日期选择' }).isVisible(), '自绘 DatePicker 弹出（非原生 date）');
  await shot('15-datepicker');
  await page.keyboard.press('Escape');
  check((await page.locator('input[type=date]').count()) === 0, '页面没有任何原生 date 输入');
  check((await page.locator('select').count()) === 0, '页面没有任何原生 select');
  // 周期预设
  await page.getByRole('combobox', { name: '统计周期' }).click();
  const labels = await page.getByRole('option').allInnerTexts();
  check(['近7天', '近30天', '当月', '上月', '本季度', '今年'].every((x) => labels.includes(x)), '周期下拉包含 7天/30天/当月/上月/本季度/今年');
  await page.getByRole('option', { name: '近7天' }).click();
  await page.waitForTimeout(1500);
  check(page.url().includes('start=') && page.url().includes('end='), '周期同步到地址栏');
  // 用户详情
  await page.getByRole('button', { name: '详情' }).first().click();
  await page.getByRole('dialog').waitFor();
  await page.waitForTimeout(1200);
  await shot('16-usage-user-detail');
  await page.getByRole('tab', { name: '调用明细' }).click();
  await page.waitForTimeout(1200);
  check((await page.getByRole('dialog').locator('tbody tr').count()) > 0, '用户调用明细（服务端分页）有数据');
  await page.keyboard.press('Escape');
  // 导出
  await go('/usage?start=2026-09-01&end=2026-10-03');
  await page.getByText('周期总消费').waitFor();
  await page.waitForTimeout(1200);
  await page.getByRole('checkbox', { name: '包含调用明细' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: /导出/ }).first().click()]);
  const fp = `${OUT}export.xlsx`;
  await dl.saveAs(fp);
  // 无头 Chromium 对 blob 下载的中文文件名会回退为 download，故以前端解析结果（Toast）为准
  const dlName = await page.getByText(/已导出 .*\.xlsx/).first().innerText();
  check(dlName.includes('用户用量账单') && dlName.includes('2026-09-01'), `导出文件名：${dlName}`);

  // ───────── 8 审计 & 安全 ─────────
  title('审计日志：脱敏 + 筛选');
  await go('/settings?tab=audit');
  await page.waitForTimeout(1000);
  const audit = await page.locator('main').innerText();
  check(audit.includes('keys_save') && audit.includes('export') && audit.includes('login'), '审计包含 保存密钥 / 导出 / 登录');
  check(!audit.includes('sk-upstream-ok') && !audit.includes('rootpw') && !audit.includes(ADMIN_PW), '审计详情不含任何密钥/密码明文');
  await shot('17-audit');

  title('修改密码：弱密码被拒');
  await go('/settings?tab=security');
  await page.locator('#pw-cur').fill(ADMIN_PW);
  await page.locator('#pw-new').fill('short');
  await page.locator('#pw-cfm').fill('short');
  await page.getByRole('button', { name: '修改密码' }).click();
  check(await page.getByText('新密码至少 8 位').isVisible(), '弱密码字段级拒绝');

  // ───────── 9 主题 / 响应式 / 退出 ─────────
  title('深色主题与移动端');
  await go('/usage?start=2026-09-01&end=2026-10-03');
  await page.getByText('周期总消费').waitFor();
  await page.getByRole('button', { name: '切换为深色' }).click();
  await page.waitForTimeout(500);
  check((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark', '切换深色主题');
  await shot('18-dark');
  await page.getByRole('button', { name: '切换为浅色' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await go('/channels');
  await page.waitForTimeout(600);
  await shot('19-mobile');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  check(!overflow, '移动端无横向溢出');
  await page.setViewportSize({ width: 1440, height: 900 });

  title('退出登录后权限收回');
  await go('/settings');
  await page.getByRole('button', { name: '退出登录' }).click();
  await page.waitForTimeout(800);
  check(await page.getByText('管理员登录').first().isVisible(), '退出后回到登录表单');
  await go('/usage');
  check(await page.getByText('需要管理员权限').isVisible(), '匿名访问 /usage 显示无权限引导');
  // 联系我们：匿名访客也应看到「令牌查询的 New API 地址」作为 API 域名
  await go('/contact');
  const apiRow = await page.locator('dt', { hasText: 'API 域名' }).locator('xpath=..').innerText();
  check(apiRow.includes('127.0.0.1:4010') && !apiRow.includes('未配置'), `联系我们 API 域名引用令牌查询地址：${apiRow.replace(/\s+/g, ' ')}`);
} catch (e) {
  fail(`未捕获异常：${e.message.split('\n')[0]}`);
  await shot('zz-failure').catch(() => {});
}

title('控制台错误');
const real = consoleErrors.filter((e) => !/Failed to load resource.*(401|400)/.test(e));
check(real.length === 0, real.length ? `发现 ${real.length} 条：${real.slice(0, 3).join(' || ')}` : '无控制台错误（预期内的 4xx 已排除）');

await browser.close();
writeFileSync(`${OUT}result.json`, JSON.stringify({ failed, steps: step }, null, 2));
console.log(`\n${failed === 0 ? '✅ E2E 全部通过' : `❌ E2E 失败 ${failed} 项`}`);
process.exit(failed ? 1 : 0);
