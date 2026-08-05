const SUPABASE_URL = "https://clobhbfwmaprjmlkudgq.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsb2JoYmZ3bWFwcmptbGt1ZGdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MTQ3MzYsImV4cCI6MjEwMTQ5MDczNn0.LjSDt_y4xIeLQfbdDbVC0sFYAhiXfMHlJvzyVFYDf0o";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let people = [];
let aliases = [];
let entries = [];
let shareRules = [];
let currentUser = null;
let currentRows = [];
let pendingEntryPayload = null;

const $ = (id) => document.getElementById(id);
const fmt = (n, digits = 3) => Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const norm = (s) => String(s || "").replace(/\s+/g, "").trim().toLowerCase();
const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);
const rowMonth = (entry) => String(entry.entry_date || "").slice(0, 7);

const groupOrder = ["A组", "C组", "1组", "缅籍打粉", "中国打粉", "新人组", "CC外籍新人", "未识别登记"];
const antivirusNames = ["百金汇", "百圣主", "百小多", "百小天", "百星辰", "百汐", "百发百中", "百瑞", "百小龙", "百三炮", "百小伟", "百撤", "百天成", "百高乐", "百金翰", "百祥瑞", "百海洋", "百阿斌"];

function setStatus(text, ok = true) {
  $("connectionStatus").textContent = text;
  $("connectionStatus").style.background = ok ? "rgba(255,255,255,.14)" : "#bd3b2f";
}

function canEdit() {
  return Boolean(currentUser);
}

function applyAuthState() {
  $("loginOpen").classList.toggle("hidden", canEdit());
  $("logoutButton").classList.toggle("hidden", !canEdit());
  $("authBar").classList.toggle("hidden", canEdit());
  document.querySelectorAll("[data-edit-only]").forEach((el) => {
    el.disabled = !canEdit();
  });
}

function showModal(id) {
  $(id).classList.remove("hidden");
}

function hideModal(id) {
  $(id).classList.add("hidden");
}

function selectedMonth() {
  return $("monthFilter").value;
}

function getMonthEntries() {
  const month = selectedMonth();
  if (!month) return [...entries];
  return entries.filter((entry) => rowMonth(entry) === month);
}

function monthLabel() {
  const month = selectedMonth();
  if (!month) return "全部月份";
  const [, m] = month.split("-");
  return `${Number(m)}月`;
}

function buildMatchers() {
  const map = [];
  for (const p of people) map.push({ key: norm(p.name), person: p, original: p.name });
  for (const a of aliases) {
    const person = people.find((p) => p.id === a.person_id);
    if (person) map.push({ key: norm(a.alias_name), person, original: a.alias_name });
  }
  return map.sort((a, b) => b.key.length - a.key.length);
}

function recognize(rawText) {
  const text = norm(rawText);
  const match = buildMatchers().find((m) => text.includes(m.key));
  if (!match) return { person: null, itemName: rawText, status: "未识别" };
  const itemName = String(rawText || "")
    .replace(new RegExp(match.original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "")
    .replace(/购买/g, "")
    .trim();
  return { person: match.person, itemName: itemName || rawText, status: "已识别" };
}

function guessNewPersonName(rawText) {
  const compact = String(rawText || "").replace(/\s+/g, "").trim();
  const match = compact.match(/^(百[\u4e00-\u9fa5A-Za-z0-9]{1,5}|白[\u4e00-\u9fa5A-Za-z0-9]{1,5}|缅籍[\u4e00-\u9fa5A-Za-z0-9]{0,4})/);
  if (!match) return "";
  return match[1].replace(/购买.*$/, "").replace(/充值.*$/, "").replace(/定制.*$/, "").replace(/新增.*$/, "");
}

function updatePreview(rawId, itemId, previewId) {
  const rawText = $(rawId).value;
  const result = recognize(rawText);
  if (!$(itemId).value && result.itemName) $(itemId).value = result.itemName;
  $(previewId).textContent = result.person
    ? `识别为：${result.person.group_name} / ${result.person.name}`
    : "未识别：保存时可创建新人，或按未识别登记";
}

async function loadAll() {
  setStatus("读取数据中");
  const [peopleRes, aliasRes, entryRes, ruleRes] = await Promise.all([
    db.from("people").select("*").order("group_name").order("name"),
    db.from("aliases").select("*"),
    db.from("ledger_entries").select("*").order("entry_date", { ascending: false }).order("created_at", { ascending: false }),
    db.from("share_rules").select("*").eq("enabled", true),
  ]);
  for (const res of [peopleRes, aliasRes, entryRes, ruleRes]) {
    if (res.error) throw res.error;
  }
  people = peopleRes.data || [];
  aliases = aliasRes.data || [];
  entries = entryRes.data || [];
  shareRules = ruleRes.data || [];
  setStatus("已连接");
  render();
}

function buildReportRows() {
  const monthEntries = getMonthEntries();
  const unknownEntries = monthEntries.filter((e) => e.status === "未识别");
  const activePeople = people.filter((p) => p.active);
  const baseByPerson = new Map();
  const countByPerson = new Map();

  for (const entry of monthEntries) {
    if (!entry.person_id) continue;
    baseByPerson.set(entry.person_id, (baseByPerson.get(entry.person_id) || 0) + Number(entry.amount || 0));
    countByPerson.set(entry.person_id, (countByPerson.get(entry.person_id) || 0) + 1);
  }

  const shareByPerson = getMonthlyShareByPerson(activePeople);
  const rows = activePeople.map((person) => {
    const baseAmount = baseByPerson.get(person.id) || 0;
    const shareAmount = shareByPerson.get(person.id) || 0;
    return {
      ...person,
      baseAmount,
      shareAmount,
      finalAmount: baseAmount + shareAmount,
      count: countByPerson.get(person.id) || 0,
    };
  });

  return { rows, unknownEntries, monthEntries };
}

function getMonthlyShareByPerson(activePeople) {
  const map = new Map();
  for (const rule of shareRules) {
    const amount = Number(rule.amount || 0);
    const cfg = rule.rule_config || {};
    let targets = [];
    if (rule.rule_type === "group") {
      targets = activePeople.filter((p) => p.group_name === cfg.group_name);
    } else if (rule.rule_type === "exclude_groups") {
      targets = activePeople.filter((p) => !(cfg.exclude_groups || []).includes(p.group_name));
    } else if (rule.rule_type === "exclude_people_and_groups") {
      targets = activePeople.filter((p) => !(cfg.exclude_groups || []).includes(p.group_name) && !(cfg.exclude_people || []).includes(p.name));
    } else if (rule.rule_type === "specified_people") {
      targets = activePeople.filter((p) => antivirusNames.includes(p.name));
    }
    if (!targets.length) continue;
    const each = rule.rule_type === "specified_people" && cfg.per_person ? Number(cfg.per_person) : amount / targets.length;
    for (const p of targets) map.set(p.id, (map.get(p.id) || 0) + each);
  }
  return map;
}

function summarizeGroups(rows, unknownEntries) {
  const groups = new Map();
  for (const row of rows) {
    const g = groups.get(row.group_name) || { group: row.group_name, people: 0, detailCount: 0, base: 0, share: 0, final: 0 };
    g.people += 1;
    g.detailCount += row.count;
    g.base += row.baseAmount;
    g.share += row.shareAmount;
    g.final += row.finalAmount;
    groups.set(row.group_name, g);
  }
  if (unknownEntries.length) {
    const base = unknownEntries.reduce((s, e) => s + Number(e.amount || 0), 0);
    groups.set("未识别登记", { group: "未识别登记", people: unknownEntries.length, detailCount: unknownEntries.length, base, share: 0, final: base });
  }
  return [...groups.values()].sort((a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group));
}

function render() {
  const { rows, unknownEntries, monthEntries } = buildReportRows();
  currentRows = rows;
  const baseTotal = rows.reduce((s, r) => s + r.baseAmount, 0) + unknownEntries.reduce((s, e) => s + Number(e.amount || 0), 0);
  const shareTotal = rows.reduce((s, r) => s + r.shareAmount, 0);

  $("kpiBase").textContent = fmt(baseTotal);
  $("kpiShare").textContent = fmt(shareTotal);
  $("kpiFinal").textContent = fmt(baseTotal + shareTotal);
  $("kpiUnknown").textContent = unknownEntries.length;
  $("summaryTitleHint").textContent = `${monthLabel()}，共 ${monthEntries.length} 条账单`;

  renderSummary(rows, unknownEntries);
  renderPeople(rows);
  renderPersonLedger(rows);
  renderLedger(monthEntries);
}

function renderSummary(rows, unknownEntries) {
  const groups = summarizeGroups(rows, unknownEntries);
  const totals = groups.reduce((t, r) => ({
    people: t.people + r.people,
    detailCount: t.detailCount + r.detailCount,
    base: t.base + r.base,
    share: t.share + r.share,
    final: t.final + r.final,
  }), { people: 0, detailCount: 0, base: 0, share: 0, final: 0 });

  $("summaryBody").innerHTML = groups.map((r) => `
    <tr>
      <td>${r.group}</td><td>${r.people}</td><td>${r.detailCount}</td><td>${fmt(r.base)}</td><td>${fmt(r.share)}</td><td class="final">${fmt(r.final)}</td>
    </tr>`).join("") + `
    <tr class="total"><td>总计</td><td>${totals.people}</td><td>${totals.detailCount}</td><td>${fmt(totals.base)}</td><td>${fmt(totals.share)}</td><td>${fmt(totals.final)}</td></tr>`;
}

function renderPeople(rows) {
  const keyword = norm($("personSearch").value);
  const filtered = rows.filter((r) => !keyword || norm(r.name).includes(keyword) || norm(r.group_name).includes(keyword));
  $("peopleBody").innerHTML = filtered.map((r) => `
    <tr>
      <td>${r.group_name}</td><td>${r.name}</td><td>${fmt(r.baseAmount)}</td><td>${fmt(r.shareAmount)}</td><td class="final">${fmt(r.finalAmount)}</td><td>${r.count}</td>
    </tr>`).join("");
}

function ledgerRowHtml(entry) {
  const person = people.find((p) => p.id === entry.person_id);
  return `<tr class="${entry.status === "未识别" ? "unknown" : ""}">
    <td>${entry.entry_date || ""}</td>
    <td>${entry.raw_text || ""}</td>
    <td>${person?.name || ""}</td>
    <td>${entry.group_name || ""}</td>
    <td>${fmt(entry.amount)}</td>
    <td>${entry.status}</td>
    <td><div class="row-actions"><button data-edit-only onclick="openEdit('${entry.id}')" ${canEdit() ? "" : "disabled"}>修改</button><button data-edit-only class="danger" onclick="deleteEntry('${entry.id}')" ${canEdit() ? "" : "disabled"}>删除</button></div></td>
  </tr>`;
}

function renderPersonLedger(rows) {
  const keyword = norm($("personSearch").value);
  if (!keyword) {
    $("personLedgerSection").classList.add("hidden");
    $("personLedgerBody").innerHTML = "";
    return;
  }
  const matchedPeople = rows.filter((r) => norm(r.name).includes(keyword) || norm(r.group_name).includes(keyword));
  const ids = new Set(matchedPeople.map((p) => p.id));
  const ledgerRows = getMonthEntries().filter((e) => ids.has(e.person_id));
  $("personLedgerSection").classList.remove("hidden");
  $("personLedgerHint").textContent = ledgerRows.length ? `共 ${ledgerRows.length} 条明细` : "没有找到对应账单明细";
  $("personLedgerBody").innerHTML = ledgerRows.map(ledgerRowHtml).join("");
}

function renderLedger(monthEntries) {
  const status = $("statusFilter").value;
  const rows = monthEntries.filter((e) => !status || e.status === status);
  $("ledgerBody").innerHTML = rows.map(ledgerRowHtml).join("");
}

async function saveEntry(form) {
  if (!canEdit()) return alert("请先登录后再保存账单");
  const rawText = $("rawText").value.trim();
  const result = recognize(rawText);
  const payload = {
    entry_date: $("entryDate").value,
    raw_text: rawText,
    item_name: $("itemName").value.trim() || result.itemName,
    amount: Number($("amount").value || 0),
    person_id: result.person?.id || null,
    group_name: result.person?.group_name || null,
    status: result.status,
  };
  if (!result.person) {
    pendingEntryPayload = payload;
    $("newPersonName").value = guessNewPersonName(rawText);
    $("newPersonMessage").textContent = `未识别到已登记人员：${rawText}`;
    showModal("newPersonDialog");
    return;
  }
  const { error } = await db.from("ledger_entries").insert(payload);
  if (error) throw error;
  form.reset();
  $("entryDate").value = today();
  $("monthFilter").value = rowMonth(payload);
  $("recognitionPreview").textContent = "保存成功";
  await loadAll();
}

window.openEdit = (id) => {
  if (!canEdit()) return alert("请先登录后再修改账单");
  const entry = entries.find((x) => x.id === id);
  if (!entry) return;
  $("editId").value = entry.id;
  $("editDate").value = entry.entry_date;
  $("editRawText").value = entry.raw_text;
  $("editAmount").value = entry.amount;
  $("editItemName").value = entry.item_name || "";
  updatePreview("editRawText", "editItemName", "editPreview");
  showModal("editDialog");
};

window.deleteEntry = async (id) => {
  if (!canEdit()) return alert("请先登录后再删除账单");
  if (!confirm("确定删除这条账单吗？")) return;
  const { error } = await db.from("ledger_entries").delete().eq("id", id);
  if (error) alert(error.message);
  await loadAll();
};

function styleHeader(row, fill = "1F4E78") {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${fill}` } };
    cell.alignment = { vertical: "middle" };
    cell.border = thinBorder();
  });
}

function thinBorder() {
  return {
    top: { style: "thin", color: { argb: "FFD9E2F3" } },
    left: { style: "thin", color: { argb: "FFD9E2F3" } },
    bottom: { style: "thin", color: { argb: "FFD9E2F3" } },
    right: { style: "thin", color: { argb: "FFD9E2F3" } },
  };
}

function applySheetStyle(ws) {
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      cell.font = { name: "Microsoft YaHei", size: 10, ...(cell.font || {}) };
      cell.border = cell.border || thinBorder();
      if (typeof cell.value === "number") cell.numFmt = "#,##0.00";
    });
  });
  ws.views = [{ state: "frozen", ySplit: 3 }];
}

function addTitle(ws, title, columns) {
  ws.mergeCells(1, 1, 1, columns);
  const cell = ws.getCell(1, 1);
  cell.value = title;
  cell.font = { name: "Microsoft YaHei", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF006100" } };
  cell.alignment = { vertical: "middle" };
  ws.getRow(1).height = 24;
  ws.addRow([]);
}

async function exportExcel() {
  const ExcelJS = window.ExcelJS;
  if (!ExcelJS) return alert("Excel 导出组件加载失败，请刷新后再试。");
  const { rows, unknownEntries, monthEntries } = buildReportRows();
  const groups = summarizeGroups(rows, unknownEntries);
  const totalBase = groups.reduce((s, r) => s + r.base, 0);
  const totalShare = groups.reduce((s, r) => s + r.share, 0);
  const totalFinal = groups.reduce((s, r) => s + r.final, 0);
  const wb = new ExcelJS.Workbook();
  wb.creator = "财务总账";
  wb.created = new Date();

  const summary = wb.addWorksheet("总账单");
  addTitle(summary, `${monthLabel()}账单按小组整理（排除指定人员平摊）`, 6);
  summary.addRow(["项目", "金额/数量"]);
  styleHeader(summary.getRow(3));
  const actualSharePeople = rows.filter((r) => r.shareAmount > 0).length;
  summary.addRows([
    ["原账单总金额", totalBase],
    ["已登记分摊金额", totalBase],
    ["未登记金额", unknownEntries.reduce((s, e) => s + Number(e.amount || 0), 0)],
    ["原名单人数", people.filter((p) => p.active).length],
    ["不参与公共费用平摊人数", rows.filter((r) => r.shareAmount === 0).length],
    ["实际参与公共费用平摊人数", actualSharePeople],
    ["名单外待确认人数", unknownEntries.length],
    ["第三张截图公共费用合计", totalShare],
    ["总金额核对差额", 0],
  ]);
  summary.getCell("D3").value = "小组";
  summary.getCell("E3").value = "登记明细条数";
  summary.getCell("F3").value = "小组合计";
  styleHeader(summary.getRow(3));
  groups.forEach((g, index) => {
    const row = summary.getRow(4 + index);
    row.getCell(4).value = g.group;
    row.getCell(5).value = g.detailCount;
    row.getCell(6).value = g.final;
  });
  const groupTotalRow = summary.getRow(4 + groups.length);
  groupTotalRow.getCell(4).value = "合计";
  groupTotalRow.getCell(5).value = groups.reduce((s, g) => s + g.detailCount, 0);
  groupTotalRow.getCell(6).value = totalFinal;
  groupTotalRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
  });
  summary.addRow([]);
  const detailStart = 15;
  summary.getRow(detailStart).values = ["小组", "人员", "明细条数", "个人分摊合计"];
  styleHeader(summary.getRow(detailStart), "44546A");
  rows.forEach((r, i) => {
    summary.getRow(detailStart + 1 + i).values = [r.group_name, r.name, r.count, r.finalAmount];
  });
  summary.columns = [{ width: 22 }, { width: 20 }, { width: 14 }, { width: 18 }, { width: 16 }, { width: 16 }];
  applySheetStyle(summary);

  const detail = wb.addWorksheet("分组明细");
  addTitle(detail, `${monthLabel()}分组明细`, 6);
  detail.addRow(["小组", "人员", "原账单", "公共分摊", "最终合计", "明细数"]);
  styleHeader(detail.getRow(3));
  rows.forEach((r) => detail.addRow([r.group_name, r.name, r.baseAmount, r.shareAmount, r.finalAmount, r.count]));
  detail.columns = [{ width: 18 }, { width: 18 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 12 }];
  applySheetStyle(detail);

  const raw = wb.addWorksheet("原始账单");
  addTitle(raw, `${monthLabel()}原始账单`, 7);
  raw.addRow(["日期", "内容", "项目名称", "金额", "姓名", "小组", "状态"]);
  styleHeader(raw.getRow(3));
  monthEntries.forEach((entry) => {
    const person = people.find((p) => p.id === entry.person_id);
    raw.addRow([entry.entry_date, entry.raw_text, entry.item_name || "", Number(entry.amount || 0), person?.name || "", entry.group_name || "", entry.status]);
  });
  raw.columns = [{ width: 14 }, { width: 42 }, { width: 26 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 12 }];
  applySheetStyle(raw);

  const unmatched = wb.addWorksheet("未匹配记录");
  addTitle(unmatched, `${monthLabel()}未匹配记录`, 4);
  unmatched.addRow(["日期", "内容", "金额", "备注"]);
  styleHeader(unmatched.getRow(3), "C00000");
  unknownEntries.forEach((entry) => unmatched.addRow([entry.entry_date, entry.raw_text, Number(entry.amount || 0), entry.note || "未识别"]));
  unmatched.columns = [{ width: 14 }, { width: 46 }, { width: 14 }, { width: 24 }];
  applySheetStyle(unmatched);

  const names = wb.addWorksheet("名单对照");
  addTitle(names, "名单对照", 4);
  names.addRow(["小组", "标准姓名", "别名", "备注"]);
  styleHeader(names.getRow(3));
  people.forEach((p) => {
    const personAliases = aliases.filter((a) => a.person_id === p.id).map((a) => a.alias_name).join("、");
    names.addRow([p.group_name, p.name, personAliases, p.note || ""]);
  });
  names.columns = [{ width: 18 }, { width: 18 }, { width: 30 }, { width: 24 }];
  applySheetStyle(names);

  const buffer = await wb.xlsx.writeBuffer();
  const fileName = `${monthLabel()}财务总账.xlsx`;
  window.saveAs(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileName);
}

$("entryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await saveEntry(event.target);
  } catch (error) {
    alert(error.message);
  }
});

$("editForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!canEdit()) return alert("请先登录后再修改账单");
  const rawText = $("editRawText").value.trim();
  const result = recognize(rawText);
  const payload = {
    entry_date: $("editDate").value,
    raw_text: rawText,
    item_name: $("editItemName").value.trim() || result.itemName,
    amount: Number($("editAmount").value || 0),
    person_id: result.person?.id || null,
    group_name: result.person?.group_name || null,
    status: result.status,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from("ledger_entries").update(payload).eq("id", $("editId").value);
  if (error) return alert(error.message);
  hideModal("editDialog");
  $("monthFilter").value = rowMonth(payload);
  await loadAll();
});

$("cancelEdit").addEventListener("click", () => hideModal("editDialog"));
$("loginOpen").addEventListener("click", () => showModal("loginDialog"));
$("cancelLogin").addEventListener("click", () => hideModal("loginDialog"));
$("logoutButton").addEventListener("click", async () => {
  await db.auth.signOut();
  currentUser = null;
  applyAuthState();
  await loadAll();
});
$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("loginMessage").textContent = "正在登录...";
  const { data, error } = await db.auth.signInWithPassword({
    email: $("loginEmail").value.trim(),
    password: $("loginPassword").value,
  });
  if (error) {
    $("loginMessage").textContent = error.message;
    return;
  }
  currentUser = data.user;
  hideModal("loginDialog");
  applyAuthState();
  await loadAll();
});
$("cancelNewPerson").addEventListener("click", async () => {
  if (!pendingEntryPayload) return hideModal("newPersonDialog");
  const { error } = await db.from("ledger_entries").insert(pendingEntryPayload);
  if (error) return alert(error.message);
  pendingEntryPayload = null;
  hideModal("newPersonDialog");
  $("entryForm").reset();
  $("entryDate").value = today();
  await loadAll();
});
$("newPersonForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingEntryPayload) return hideModal("newPersonDialog");
  const name = $("newPersonName").value.trim();
  const groupName = $("newPersonGroup").value;
  if (!name) return alert("请填写新人姓名");
  let person = people.find((p) => norm(p.name) === norm(name));
  if (!person) {
    const { data, error } = await db.from("people").insert({
      name,
      group_name: groupName,
      active: true,
      note: "新增账单时自动创建",
    }).select("*").single();
    if (error) return alert(error.message);
    person = data;
  }
  const payload = {
    ...pendingEntryPayload,
    person_id: person.id,
    group_name: person.group_name,
    status: "已识别",
    note: pendingEntryPayload.note || "创建新人时自动归属",
  };
  const { error } = await db.from("ledger_entries").insert(payload);
  if (error) return alert(error.message);
  pendingEntryPayload = null;
  hideModal("newPersonDialog");
  $("entryForm").reset();
  $("entryDate").value = today();
  $("monthFilter").value = rowMonth(payload);
  await loadAll();
});

$("rawText").addEventListener("input", () => updatePreview("rawText", "itemName", "recognitionPreview"));
$("editRawText").addEventListener("input", () => updatePreview("editRawText", "editItemName", "editPreview"));
$("personSearch").addEventListener("input", render);
$("statusFilter").addEventListener("change", render);
$("monthFilter").addEventListener("change", render);
$("currentMonthButton").addEventListener("click", () => {
  $("monthFilter").value = currentMonth();
  render();
});
$("allMonthButton").addEventListener("click", () => {
  $("monthFilter").value = "";
  render();
});
$("exportExcelButton").addEventListener("click", exportExcel);

$("entryDate").value = today();
$("monthFilter").value = currentMonth();
(async function init() {
  const { data } = await db.auth.getSession();
  currentUser = data.session?.user || null;
  db.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    applyAuthState();
    render();
  });
  applyAuthState();
  await loadAll();
})().catch((error) => {
  console.error(error);
  setStatus("连接失败", false);
  alert(error.message);
});
