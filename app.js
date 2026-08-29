const SUPABASE_URL = "https://clobhbfwmaprjmlkudgq.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsb2JoYmZ3bWFwcmptbGt1ZGdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MTQ3MzYsImV4cCI6MjEwMTQ5MDczNn0.LjSDt_y4xIeLQfbdDbVC0sFYAhiXfMHlJvzyVFYDf0o";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let people = [];
let aliases = [];
let entries = [];
let incomes = [];
let groups = [];
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
const incomeMonth = (income) => String(income.income_date || "").slice(0, 7);

const ungroupedName = "未分组";
const defaultGroups = ["A组", "C组", "一组", "缅籍打粉", "中国打粉", "阿U团队打粉", "百汐外籍", ungroupedName];
const defaultGroupColors = {
  "A组": "DDEBF7",
  "C组": "E2F0D9",
  "一组": "FFF2CC",
  "缅籍打粉": "FCE4D6",
  "中国打粉": "EADCF8",
  "阿U团队打粉": "DDEBF7",
  "百汐外籍": "E7E6E6",
  "未分组": "F3F5F7",
  "未识别登记": "F4CCCC",
};
const antivirusNames = [];

function editableGroups() {
  const active = groups.filter((group) => group.active).map((group) => group.name);
  return active.length ? active : defaultGroups;
}

function allGroupNames() {
  const names = groups.length ? groups.map((group) => group.name) : defaultGroups;
  return [...names, "未识别登记"];
}

function groupColor(groupName) {
  const fromDb = groups.find((group) => group.name === groupName)?.color;
  return (fromDb || defaultGroupColors[groupName] || "E7E6E6").replace("#", "").toUpperCase();
}

function groupSortIndex(groupName) {
  const group = groups.find((item) => item.name === groupName);
  if (group) return Number(group.sort_order || 100);
  const index = defaultGroups.indexOf(groupName);
  if (index >= 0) return (index + 1) * 10;
  if (groupName === "未识别登记") return 9999;
  return 9000;
}

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

function populateGroupSelects() {
  for (const id of ["newPersonGroup", "personGroup"]) {
    const select = $(id);
    if (!select) continue;
    const currentValue = select.value;
    const options = editableGroups();
    select.innerHTML = options.map((group) => `<option value="${group}">${group}</option>`).join("");
    if (currentValue && options.includes(currentValue)) select.value = currentValue;
  }
}

function selectedMonth() {
  return $("monthFilter").value;
}

function getMonthEntries() {
  const month = selectedMonth();
  if (!month) return [...entries];
  return entries.filter((entry) => rowMonth(entry) === month);
}

function getMonthIncomes() {
  const month = selectedMonth();
  if (!month) return [...incomes];
  return incomes.filter((income) => incomeMonth(income) === month);
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
  const matches = [];
  const usedPersonIds = new Set();
  for (const matcher of buildMatchers()) {
    if (!matcher.key || !text.includes(matcher.key) || usedPersonIds.has(matcher.person.id)) continue;
    matches.push(matcher);
    usedPersonIds.add(matcher.person.id);
  }
  if (!matches.length) return { person: null, people: [], itemName: rawText, status: "未识别" };
  let itemName = String(rawText || "");
  for (const match of matches) {
    itemName = itemName.replace(new RegExp(match.original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "");
  }
  itemName = itemName.replace(/购买/g, "").replace(/[、，,和+]+/g, " ").trim();
  return {
    person: matches[0].person,
    people: matches.map((match) => match.person),
    itemName: itemName || rawText,
    status: "已识别",
  };
}

function entryLines(rawText) {
  return String(rawText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function parseLineAmount(line) {
  const matches = [...String(line || "").matchAll(/(?:￥|¥)?\s*(-?\d+(?:,\d{3})*(?:\.\d+)?)/g)];
  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  const amount = Number(last[1].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;
  return { amount, text: `${line.slice(0, last.index)} ${line.slice(last.index + last[0].length)}`.trim() };
}

function guessNewPersonName(rawText) {
  const compact = String(rawText || "").replace(/\s+/g, "").trim();
  const match = compact.match(/^(百[\u4e00-\u9fa5A-Za-z0-9]{1,5}|白[\u4e00-\u9fa5A-Za-z0-9]{1,5}|缅籍[\u4e00-\u9fa5A-Za-z0-9]{0,4})/);
  if (!match) return "";
  return match[1].replace(/购买.*$/, "").replace(/充值.*$/, "").replace(/定制.*$/, "").replace(/新增.*$/, "");
}

function updatePreview(rawId, itemId, previewId) {
  const rawText = $(rawId).value;
  const lines = entryLines(rawText);
  const fallbackAmount = Number($(rawId === "rawText" ? "amount" : "editAmount")?.value || 0);
  if (rawId === "rawText" && lines.length > 1) {
    const parsed = lines.map((line) => {
      const parsedAmount = parseLineAmount(line);
      const text = parsedAmount?.text || line;
      const result = recognize(text);
      return { line, amount: parsedAmount?.amount || fallbackAmount, result };
    });
    const missingAmount = parsed.filter((row) => !row.amount).length;
    const unknown = parsed.filter((row) => !row.result.person).length;
    const recognizedPeople = parsed.reduce((sum, row) => sum + (row.result.people?.length || (row.result.person ? 1 : 0)), 0);
    $(previewId).textContent = `批量识别：${lines.length} 行，${recognizedPeople} 笔人员账单${missingAmount ? `，${missingAmount} 行缺少金额` : ""}${unknown ? `，${unknown} 行未识别姓名` : ""}`;
    return;
  }
  const parsedAmount = parseLineAmount(rawText);
  const result = recognize(parsedAmount?.text || rawText);
  if (!$(itemId).value && result.itemName) $(itemId).value = result.itemName;
  const totalAmount = parsedAmount?.amount || fallbackAmount;
  if (result.people?.length > 1) {
    const each = totalAmount ? `，每人 ${fmt(totalAmount / result.people.length)}` : "";
    $(previewId).textContent = `识别到 ${result.people.length} 人：${result.people.map((p) => `${p.group_name}/${p.name}`).join("、")}，保存时自动平分${each}`;
  } else {
    $(previewId).textContent = result.person
      ? `识别为：${result.person.group_name} / ${result.person.name}`
      : "未识别：保存时可创建新人，或按未识别登记";
  }
}

async function loadAll() {
  setStatus("读取数据中");
  const [peopleRes, aliasRes, entryRes, incomeRes, groupRes, ruleRes] = await Promise.all([
    db.from("people").select("*").order("group_name").order("name"),
    db.from("aliases").select("*"),
    db.from("ledger_entries").select("*").order("entry_date", { ascending: false }).order("created_at", { ascending: false }),
    db.from("finance_incomes").select("*").order("income_date", { ascending: false }).order("created_at", { ascending: false }),
    db.from("groups").select("*").order("sort_order").order("name"),
    db.from("share_rules").select("*").eq("enabled", true),
  ]);
  for (const res of [peopleRes, aliasRes, entryRes, ruleRes]) {
    if (res.error) throw res.error;
  }
  people = peopleRes.data || [];
  aliases = aliasRes.data || [];
  entries = entryRes.data || [];
  incomes = incomeRes.error ? [] : (incomeRes.data || []);
  groups = groupRes.error ? [] : (groupRes.data || []);
  shareRules = ruleRes.data || [];
  populateGroupSelects();
  setStatus(incomeRes.error || groupRes.error ? "需执行SQL" : "已连接", !(incomeRes.error || groupRes.error));
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
  const reportPeople = people.filter((p) => p.active || baseByPerson.has(p.id));
  const rows = reportPeople.map((person) => {
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

function entryAmount(entry) {
  return Number(entry.amount || 0);
}

function incomeAmount(income) {
  return Number(income.amount || 0);
}

function monthExpenseTotal(month) {
  return entries
    .filter((entry) => !month || rowMonth(entry) === month)
    .reduce((sum, entry) => sum + entryAmount(entry), 0);
}

function monthIncomeTotal(month) {
  return incomes
    .filter((income) => !month || incomeMonth(income) === month)
    .reduce((sum, income) => sum + incomeAmount(income), 0);
}

function buildBalanceReport(expenseTotal) {
  const month = selectedMonth();
  if (!month) {
    const income = monthIncomeTotal("");
    return {
      opening: 0,
      income,
      expense: expenseTotal,
      balance: income - expenseTotal,
    };
  }
  const openingIncome = incomes
    .filter((income) => incomeMonth(income) < month)
    .reduce((sum, income) => sum + incomeAmount(income), 0);
  const openingExpense = entries
    .filter((entry) => rowMonth(entry) < month)
    .reduce((sum, entry) => sum + entryAmount(entry), 0);
  const opening = openingIncome - openingExpense;
  const income = monthIncomeTotal(month);
  return {
    opening,
    income,
    expense: expenseTotal,
    balance: opening + income - expenseTotal,
  };
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
  return [...groups.values()].sort((a, b) => groupSortIndex(a.group) - groupSortIndex(b.group));
}

function groupSummaryLabel(group) {
  if (group.group === "未识别登记") return `${group.group}(${group.detailCount}条)`;
  if (group.group === "阿U团队打粉" && group.people === 1) {
    const member = currentRows.find((row) => row.group_name === group.group);
    return `${group.group}${member?.name || ""}(${group.people}人)`;
  }
  return `${group.group}(${group.people}人)`;
}

function render() {
  const { rows, unknownEntries, monthEntries } = buildReportRows();
  currentRows = rows;
  const baseTotal = rows.reduce((s, r) => s + r.baseAmount, 0) + unknownEntries.reduce((s, e) => s + Number(e.amount || 0), 0);
  const shareTotal = rows.reduce((s, r) => s + r.shareAmount, 0);
  const balance = buildBalanceReport(baseTotal + shareTotal);

  $("kpiOpening").textContent = fmt(balance.opening);
  $("kpiIncome").textContent = fmt(balance.income);
  $("kpiBase").textContent = fmt(baseTotal);
  $("kpiFinal").textContent = fmt(baseTotal + shareTotal);
  $("kpiBalance").textContent = fmt(balance.balance);
  $("kpiUnknown").textContent = unknownEntries.length;
  $("summaryTitleHint").textContent = `${monthLabel()}，共 ${monthEntries.length} 条账单`;

  renderIncomes();
  renderSummary(rows, unknownEntries);
  renderPeople(rows);
  renderPersonManager();
  renderPersonLedger(rows);
  renderLedger(monthEntries);
}

function renderIncomes() {
  const rows = getMonthIncomes();
  $("incomeBody").innerHTML = rows.map((income) => `
    <tr>
      <td>${income.income_date || ""}</td>
      <td class="final">${fmt(income.amount)}</td>
      <td>${income.source || income.note || ""}</td>
      <td>
        <div class="row-actions">
          <button data-edit-only onclick="editIncome('${income.id}')" ${canEdit() ? "" : "disabled"}>编辑</button>
          <button data-edit-only class="danger" onclick="deleteIncome('${income.id}')" ${canEdit() ? "" : "disabled"}>删除</button>
        </div>
      </td>
    </tr>`).join("");
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
      <td>${groupSummaryLabel(r)}</td><td>${r.people}</td><td>${r.detailCount}</td><td>${fmt(r.base)}</td><td>${fmt(r.share)}</td><td class="final">${fmt(r.final)}</td><td>${summaryActions(r.group)}</td>
    </tr>`).join("") + `
    <tr class="total"><td>总计</td><td>${totals.people}</td><td>${totals.detailCount}</td><td>${fmt(totals.base)}</td><td>${fmt(totals.share)}</td><td>${fmt(totals.final)}</td><td></td></tr>`;
}

function summaryActions(groupName) {
  if (groupName === "未识别登记") {
    return `<div class="row-actions"><button type="button" onclick="manageGroup('${groupName}')">查看</button></div>`;
  }
  return `
    <div class="row-actions">
      <button data-edit-only type="button" onclick="addPersonToGroup('${groupName}')" ${canEdit() ? "" : "disabled"}>添加</button>
      <button type="button" class="secondary" onclick="manageGroup('${groupName}')">管理</button>
    </div>`;
}

function renderPeople(rows) {
  const keyword = norm($("personSearch").value);
  const filtered = rows.filter((r) => !keyword || norm(r.name).includes(keyword) || norm(r.group_name).includes(keyword));
  $("peopleBody").innerHTML = filtered.map((r) => `
    <tr>
      <td>${r.group_name}</td><td>${r.name}</td><td>${fmt(r.baseAmount)}</td><td>${fmt(r.shareAmount)}</td><td class="final">${fmt(r.finalAmount)}</td><td>${r.count}</td>
    </tr>`).join("");
}

function personAliasText(personId) {
  return aliases.filter((a) => a.person_id === personId).map((a) => a.alias_name).join("、");
}

function renderPersonManager() {
  const keyword = norm($("personSearch").value);
  const countByPerson = new Map();
  for (const entry of entries) {
    if (!entry.person_id) continue;
    countByPerson.set(entry.person_id, (countByPerson.get(entry.person_id) || 0) + 1);
  }
  const rows = people
    .filter((p) => !keyword || norm(p.name).includes(keyword) || norm(p.group_name).includes(keyword) || norm(personAliasText(p.id)).includes(keyword))
    .sort((a, b) => {
      const orderDiff = groupSortIndex(a.group_name) - groupSortIndex(b.group_name);
      return orderDiff || a.name.localeCompare(b.name, "zh-CN");
    });
  $("personManagerBody").innerHTML = rows.map((p) => `
    <tr class="${p.active ? "" : "inactive"}">
      <td>${p.active ? "启用" : "停用"}</td>
      <td>${p.group_name}</td>
      <td>${p.name}</td>
      <td>${personAliasText(p.id) || ""}</td>
      <td>${countByPerson.get(p.id) || 0}</td>
      <td>
        <div class="row-actions">
          <button data-edit-only onclick="editPerson('${p.id}')" ${canEdit() ? "" : "disabled"}>编辑</button>
          <button data-edit-only class="${p.active ? "danger" : "secondary"}" onclick="togglePerson('${p.id}')" ${canEdit() ? "" : "disabled"}>${p.active ? "停用" : "启用"}</button>
          <button data-edit-only class="danger" onclick="deletePerson('${p.id}')" ${canEdit() ? "" : "disabled"}>删除</button>
        </div>
      </td>
    </tr>`).join("");
}

function resetPersonForm() {
  $("personId").value = "";
  $("personName").value = "";
  $("personAliases").value = "";
  $("personGroup").value = editableGroups()[0] || "";
  $("personManagerMessage").textContent = "选择人员可编辑；停用后不参与后续汇总。";
}

function focusPersonManager(message) {
  const form = $("personForm");
  if (form) form.scrollIntoView({ behavior: "smooth", block: "start" });
  if (message) $("personManagerMessage").textContent = message;
}

window.addPersonToGroup = (groupName) => {
  if (!canEdit()) return alert("请先登录后再添加人员");
  if (!editableGroups().includes(groupName)) return;
  resetPersonForm();
  $("personGroup").value = groupName;
  $("personSearch").value = groupName;
  render();
  focusPersonManager(`正在给 ${groupName} 添加人员`);
  $("personName").focus();
};

window.manageGroup = (groupName) => {
  $("personSearch").value = groupName === "未识别登记" ? "未识别" : groupName;
  resetPersonForm();
  render();
  focusPersonManager(groupName === "未识别登记" ? "正在查看未识别记录" : `正在管理：${groupName}`);
};

function populateDeleteGroupSelect() {
  const select = $("deleteGroupName");
  if (!select) return;
  const options = editableGroups().filter((group) => group !== ungroupedName);
  select.innerHTML = options.map((group) => `<option value="${group}">${group}</option>`).join("");
}

function resetGroupForm() {
  $("groupOriginalName").value = "";
  $("groupName").value = "";
  $("groupSort").value = "";
  $("groupColor").value = "#e7e6e6";
  $("groupManagerMessage").textContent = "删除小组后，人员会转入未分组。";
}

function setGroupDialogMode(mode) {
  resetGroupForm();
  $("groupForm").dataset.mode = mode;
  const isDelete = mode === "delete";
  $("groupDialogTitle").textContent = isDelete ? "删除小组" : "添加小组";
  $("submitGroupAction").textContent = isDelete ? "确认删除" : "保存小组";
  $("submitGroupAction").classList.toggle("danger", isDelete);
  $("groupNameLabel").classList.toggle("hidden", isDelete);
  $("groupSortLabel").classList.toggle("hidden", isDelete);
  $("groupColorLabel").classList.toggle("hidden", isDelete);
  $("groupDeleteLabel").classList.toggle("hidden", !isDelete);
  if (isDelete) {
    populateDeleteGroupSelect();
    $("groupManagerMessage").textContent = `删除后，该小组所有人员和账单会转入「${ungroupedName}」。`;
  }
  showModal("groupDialog");
}

async function ensureUngroupedGroup() {
  const existing = groups.find((group) => group.name === ungroupedName);
  if (existing) {
    if (!existing.active) {
      const { error } = await db.from("groups").update({ active: true, updated_at: new Date().toISOString() }).eq("name", ungroupedName);
      if (error) throw error;
    }
    return;
  }
  const { error } = await db.from("groups").insert({
    name: ungroupedName,
    sort_order: 900,
    color: defaultGroupColors[ungroupedName],
    active: true,
    note: "删除小组后人员自动归入",
  });
  if (error) throw error;
}

function parseAliasInput(value) {
  return [...new Set(String(value || "").split(/[,\s，、]+/).map((x) => x.trim()).filter(Boolean))];
}

window.editPerson = (id) => {
  if (!canEdit()) return alert("请先登录后再编辑人员");
  const person = people.find((p) => p.id === id);
  if (!person) return;
  $("personId").value = person.id;
  $("personName").value = person.name;
  $("personGroup").value = person.group_name;
  $("personAliases").value = personAliasText(person.id);
  $("personManagerMessage").textContent = `正在编辑：${person.name}`;
  $("personName").focus();
};

window.togglePerson = async (id) => {
  if (!canEdit()) return alert("请先登录后再调整人员状态");
  const person = people.find((p) => p.id === id);
  if (!person) return;
  const nextActive = !person.active;
  const text = nextActive ? "启用" : "停用";
  if (!confirm(`确定${text} ${person.name} 吗？`)) return;
  const { error } = await db.from("people").update({ active: nextActive }).eq("id", id);
  if (error) return alert(error.message);
  await loadAll();
};

window.deletePerson = async (id) => {
  if (!canEdit()) return alert("请先登录后再删除人员");
  const person = people.find((p) => p.id === id);
  if (!person) return;
  const relatedCount = entries.filter((entry) => entry.person_id === id).length;
  const suffix = relatedCount ? `\n\n这个人员有 ${relatedCount} 条历史账单，删除后这些账单会保留，并转为未识别登记。` : "";
  if (!confirm(`确定删除 ${person.name} 吗？${suffix}`)) return;
  const aliasDelete = await db.from("aliases").delete().eq("person_id", id);
  if (aliasDelete.error) return alert(aliasDelete.error.message);
  if (relatedCount) {
    const entryUpdate = await db.from("ledger_entries").update({
      person_id: null,
      group_name: "未识别登记",
      status: "未识别",
      updated_at: new Date().toISOString(),
    }).eq("person_id", id);
    if (entryUpdate.error) return alert(entryUpdate.error.message);
  }
  const personDelete = await db.from("people").delete().eq("id", id);
  if (personDelete.error) return alert(personDelete.error.message);
  resetPersonForm();
  $("personManagerMessage").textContent = "人员已删除，历史账单已保留。";
  await loadAll();
};

function resetIncomeForm() {
  $("incomeId").value = "";
  $("incomeDate").value = today();
  $("incomeAmount").value = "";
  $("incomeSource").value = "";
  $("incomeMessage").textContent = "录入后会自动参与本月余额计算。";
}

window.editIncome = (id) => {
  if (!canEdit()) return alert("请先登录后再编辑入账");
  const income = incomes.find((x) => x.id === id);
  if (!income) return;
  $("incomeId").value = income.id;
  $("incomeDate").value = income.income_date;
  $("incomeAmount").value = income.amount;
  $("incomeSource").value = income.source || income.note || "";
  $("incomeMessage").textContent = `正在编辑入账：${fmt(income.amount)}`;
  $("incomeAmount").focus();
};

window.deleteIncome = async (id) => {
  if (!canEdit()) return alert("请先登录后再删除入账");
  if (!confirm("确定删除这条入账记录吗？")) return;
  const { error } = await db.from("finance_incomes").delete().eq("id", id);
  if (error) return alert(error.message);
  await loadAll();
};

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
  const lines = entryLines(rawText);
  const fallbackAmount = Number($("amount").value || 0);
  if (lines.length > 1) {
    const rows = [];
    const unknownLines = [];
    const missingAmountLines = [];
    for (const line of lines) {
      const parsedAmount = parseLineAmount(line);
      const lineText = parsedAmount?.text || line;
      const result = recognize(lineText);
      const totalAmount = parsedAmount?.amount || fallbackAmount;
      if (!totalAmount) {
        missingAmountLines.push(line);
        continue;
      }
      if (!result.person) {
        unknownLines.push(line);
        continue;
      }
      const targets = result.people?.length ? result.people : [result.person];
      const eachAmount = totalAmount / targets.length;
      for (const person of targets) {
        rows.push({
          entry_date: $("entryDate").value,
          raw_text: line,
          item_name: result.itemName,
          amount: eachAmount,
          person_id: person.id,
          group_name: person.group_name,
          status: "已识别",
          note: targets.length > 1 ? `多人账单自动平分：总额 ${fmt(totalAmount)}，共 ${targets.length} 人` : "批量导入",
        });
      }
    }
    if (missingAmountLines.length || unknownLines.length) {
      const messages = [];
      if (missingAmountLines.length) messages.push(`缺少金额：\n${missingAmountLines.join("\n")}`);
      if (unknownLines.length) messages.push(`未识别姓名：\n${unknownLines.join("\n")}`);
      alert(`有内容需要先处理，暂未保存：\n\n${messages.join("\n\n")}`);
      return;
    }
    const { error } = await db.from("ledger_entries").insert(rows);
    if (error) throw error;
    form.reset();
    $("entryDate").value = today();
    $("monthFilter").value = rowMonth(rows[0]);
    $("recognitionPreview").textContent = `保存成功：批量导入 ${rows.length} 笔账单`;
    await loadAll();
    return;
  }
  const parsedAmount = parseLineAmount(rawText);
  const singleText = parsedAmount?.text || rawText;
  const result = recognize(singleText);
  const totalAmount = parsedAmount?.amount || fallbackAmount;
  if (!totalAmount) return alert("请填写金额，或在内容最后写上金额。");
  const payload = {
    entry_date: $("entryDate").value,
    raw_text: rawText,
    item_name: $("itemName").value.trim() || result.itemName,
    amount: totalAmount,
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
  const targets = result.people?.length ? result.people : [result.person];
  const eachAmount = totalAmount / targets.length;
  const rows = targets.map((person) => ({
    ...payload,
    amount: eachAmount,
    person_id: person.id,
    group_name: person.group_name,
    status: "已识别",
    note: targets.length > 1 ? `多人账单自动平分：总额 ${fmt(totalAmount)}，共 ${targets.length} 人` : payload.note,
  }));
  const { error } = await db.from("ledger_entries").insert(rows);
  if (error) throw error;
  form.reset();
  $("entryDate").value = today();
  $("monthFilter").value = rowMonth(payload);
  $("recognitionPreview").textContent = targets.length > 1 ? `保存成功：已拆分 ${targets.length} 条，每人 ${fmt(eachAmount)}` : "保存成功";
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

function fillRow(row, color) {
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${color}` } };
  });
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
  const monthIncomes = getMonthIncomes();
  const groups = summarizeGroups(rows, unknownEntries);
  const totalFinal = groups.reduce((s, r) => s + r.final, 0);
  const balance = buildBalanceReport(totalFinal);
  const wb = new ExcelJS.Workbook();
  wb.creator = "财务总账";
  wb.created = new Date();

  const summary = wb.addWorksheet("总账单");
  addTitle(summary, `${monthLabel()}财务总账`, 6);
  summary.getCell("A3").value = "项目";
  summary.getCell("B3").value = "金额/数量";
  summary.getCell("D3").value = "小组";
  summary.getCell("F3").value = "小组合计";
  styleHeader(summary.getRow(3));
  const balanceRows = [
    ["期初结余", balance.opening],
    ["本月入账", balance.income],
    ["本月支出", balance.expense],
    ["剩余可用额度", balance.balance],
    ["本月入账条数", monthIncomes.length],
    ["本月账单条数", monthEntries.length],
  ];
  balanceRows.forEach((item, index) => {
    const row = summary.getRow(4 + index);
    row.getCell(1).value = item[0];
    row.getCell(2).value = item[1];
  });
  groups.forEach((g, index) => {
    const row = summary.getRow(4 + index);
    row.getCell(4).value = groupSummaryLabel(g);
    row.getCell(6).value = g.final;
  });
  const groupTotalRow = summary.getRow(4 + groups.length);
  groupTotalRow.getCell(4).value = "合计";
  groupTotalRow.getCell(6).value = totalFinal;
  groupTotalRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
  });
  let currentRow = 4 + groups.length + 3;
  for (const groupName of allGroupNames().filter((g) => g !== "未识别登记")) {
    const members = rows.filter((r) => r.group_name === groupName);
    if (!members.length) continue;
    const color = groupColor(groupName);
    const titleRow = summary.getRow(currentRow);
    titleRow.getCell(1).value = `${groupName}（${members.length}人）`;
    titleRow.getCell(2).value = "人员";
    titleRow.getCell(3).value = "明细数";
    titleRow.getCell(4).value = "总金额";
    styleHeader(titleRow, "44546A");
    currentRow += 1;
    for (const member of members) {
      const row = summary.getRow(currentRow);
      row.getCell(1).value = groupName;
      row.getCell(2).value = member.name;
      row.getCell(3).value = member.count;
      row.getCell(4).value = member.finalAmount;
      fillRow(row, color);
      currentRow += 1;
    }
    const totalRow = summary.getRow(currentRow);
    totalRow.getCell(1).value = `${groupName}合计`;
    totalRow.getCell(3).value = members.reduce((s, r) => s + r.count, 0);
    totalRow.getCell(4).value = members.reduce((s, r) => s + r.finalAmount, 0);
    fillRow(totalRow, "FFF2CC");
    totalRow.font = { bold: true };
    currentRow += 2;
  }
  const unknownGroup = groups.find((g) => g.group === "未识别登记");
  if (unknownGroup) {
    const titleRow = summary.getRow(currentRow);
    titleRow.getCell(1).value = `未识别登记（${unknownGroup.people}条）`;
    titleRow.getCell(2).value = "项目";
    titleRow.getCell(3).value = "明细数";
    titleRow.getCell(4).value = "总金额";
    styleHeader(titleRow, "C00000");
    currentRow += 1;
    unknownEntries.forEach((entry) => {
      const row = summary.getRow(currentRow);
      row.getCell(1).value = "未识别登记";
      row.getCell(2).value = entry.raw_text;
      row.getCell(3).value = 1;
      row.getCell(4).value = Number(entry.amount || 0);
      fillRow(row, groupColor("未识别登记"));
      currentRow += 1;
    });
  }
  summary.columns = [{ width: 22 }, { width: 24 }, { width: 14 }, { width: 16 }, { width: 12 }, { width: 16 }];
  summary.eachRow((row) => {
    row.getCell(2).numFmt = "#,##0.00";
    row.getCell(6).numFmt = "#,##0.00";
    row.getCell(4).numFmt = "#,##0.00";
  });
  applySheetStyle(summary);

  const incomeSheet = wb.addWorksheet("入账记录");
  addTitle(incomeSheet, `${monthLabel()}入账记录`, 4);
  incomeSheet.addRow(["日期", "金额", "来源/备注", "创建时间"]);
  styleHeader(incomeSheet.getRow(3), "16756F");
  monthIncomes.forEach((income) => {
    incomeSheet.addRow([income.income_date, Number(income.amount || 0), income.source || income.note || "", income.created_at || ""]);
  });
  const incomeTotalRow = incomeSheet.addRow(["合计", balance.income, "", ""]);
  fillRow(incomeTotalRow, "FFF2CC");
  incomeTotalRow.font = { bold: true };
  incomeSheet.columns = [{ width: 14 }, { width: 16 }, { width: 36 }, { width: 24 }];
  applySheetStyle(incomeSheet);

  const detail = wb.addWorksheet("分组明细");
  addTitle(detail, `${monthLabel()}各小组详细明细`, 6);
  let detailRow = 3;
  for (const groupName of allGroupNames().filter((g) => g !== "未识别登记")) {
    const members = rows.filter((r) => r.group_name === groupName);
    if (!members.length) continue;
    const header = detail.getRow(detailRow);
    header.values = [`${groupName}（${members.length}人）`, "人员", "日期", "内容", "金额", "状态"];
    styleHeader(header, "44546A");
    detailRow += 1;
    for (const member of members) {
      const memberEntries = monthEntries.filter((e) => e.person_id === member.id);
      if (!memberEntries.length) {
        const row = detail.getRow(detailRow);
        row.values = [groupName, member.name, "", "本月无明细", 0, ""];
        fillRow(row, groupColor(groupName));
        detailRow += 1;
        continue;
      }
      memberEntries.forEach((entry) => {
        const row = detail.getRow(detailRow);
        row.values = [groupName, member.name, entry.entry_date, entry.raw_text, Number(entry.amount || 0), entry.status];
        fillRow(row, groupColor(groupName));
        detailRow += 1;
      });
      const totalRow = detail.getRow(detailRow);
      totalRow.values = [groupName, `${member.name}合计`, "", "", memberEntries.reduce((s, e) => s + Number(e.amount || 0), 0), ""];
      fillRow(totalRow, "FFF2CC");
      totalRow.font = { bold: true };
      detailRow += 1;
    }
    detailRow += 1;
  }
  if (unknownEntries.length) {
    const header = detail.getRow(detailRow);
    header.values = [`未识别登记（${unknownEntries.length}条）`, "项目", "日期", "内容", "金额", "状态"];
    styleHeader(header, "C00000");
    detailRow += 1;
    unknownEntries.forEach((entry) => {
      const row = detail.getRow(detailRow);
      row.values = ["未识别登记", entry.raw_text, entry.entry_date, entry.raw_text, Number(entry.amount || 0), entry.status];
      fillRow(row, groupColor("未识别登记"));
      detailRow += 1;
    });
  }
  detail.columns = [{ width: 20 }, { width: 18 }, { width: 14 }, { width: 46 }, { width: 14 }, { width: 12 }];
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

$("incomeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!canEdit()) return alert("请先登录后再保存入账");
  const id = $("incomeId").value;
  const payload = {
    income_date: $("incomeDate").value,
    amount: Number($("incomeAmount").value || 0),
    source: $("incomeSource").value.trim(),
    note: $("incomeSource").value.trim(),
    updated_at: new Date().toISOString(),
  };
  if (id) {
    const { error } = await db.from("finance_incomes").update(payload).eq("id", id);
    if (error) return alert(error.message);
  } else {
    const { error } = await db.from("finance_incomes").insert(payload);
    if (error) return alert(error.message);
  }
  $("monthFilter").value = incomeMonth(payload);
  resetIncomeForm();
  $("incomeMessage").textContent = "入账已保存";
  await loadAll();
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

$("personForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!canEdit()) return alert("请先登录后再保存人员");
  const id = $("personId").value;
  const name = $("personName").value.trim();
  const groupName = $("personGroup").value;
  const aliasNames = parseAliasInput($("personAliases").value).filter((alias) => norm(alias) !== norm(name));
  if (!name) return alert("请填写姓名");

  let personId = id;
  if (id) {
    const { error } = await db.from("people").update({
      name,
      group_name: groupName,
      active: true,
      note: "网站人员管理更新",
    }).eq("id", id);
    if (error) return alert(error.message);
  } else {
    const exists = people.find((p) => norm(p.name) === norm(name));
    if (exists) return alert("这个姓名已经存在，请直接编辑原人员。");
    const { data, error } = await db.from("people").insert({
      name,
      group_name: groupName,
      active: true,
      note: "网站人员管理创建",
    }).select("*").single();
    if (error) return alert(error.message);
    personId = data.id;
  }

  const deleteRes = await db.from("aliases").delete().eq("person_id", personId);
  if (deleteRes.error) return alert(deleteRes.error.message);
  if (aliasNames.length) {
    const rows = aliasNames.map((alias) => ({ alias_name: alias, person_id: personId, note: "网站人员管理设置" }));
    const { error } = await db.from("aliases").insert(rows);
    if (error) return alert(error.message);
  }

  resetPersonForm();
  $("personManagerMessage").textContent = "人员已保存";
  await loadAll();
});

$("groupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!canEdit()) return alert("请先登录后再保存小组");
  const mode = $("groupForm").dataset.mode || "add";
  if (mode === "delete") {
    const groupName = $("deleteGroupName").value;
    if (!groupName) return alert("请选择要删除的小组");
    if (groupName === ungroupedName) return alert("未分组不能删除。");
    if (!confirm(`确定删除「${groupName}」吗？人员和账单会转入「${ungroupedName}」。`)) return;
    await ensureUngroupedGroup();
    const peopleUpdate = await db.from("people").update({ group_name: ungroupedName }).eq("group_name", groupName);
    if (peopleUpdate.error) return alert(peopleUpdate.error.message);
    const entryUpdate = await db.from("ledger_entries").update({ group_name: ungroupedName }).eq("group_name", groupName);
    if (entryUpdate.error) return alert(entryUpdate.error.message);
    const groupUpdate = await db.from("groups").update({ active: false, updated_at: new Date().toISOString() }).eq("name", groupName);
    if (groupUpdate.error) return alert(groupUpdate.error.message);
    hideModal("groupDialog");
    await loadAll();
    return;
  }

  const originalName = $("groupOriginalName").value.trim();
  const name = $("groupName").value.trim();
  const sortOrder = Number($("groupSort").value || 100);
  const color = $("groupColor").value.replace("#", "").toUpperCase();
  if (!name) return alert("请填写小组名称");
  if (name === "未识别登记") return alert("未识别登记是系统保留名称，不能作为普通小组。");

  if (originalName && originalName !== name) {
    const duplicate = groups.find((group) => norm(group.name) === norm(name));
    if (duplicate) return alert("这个小组名称已经存在。");
  }

  if (originalName) {
    const { error } = await db.from("groups").update({
      name,
      sort_order: sortOrder,
      color,
      active: true,
      updated_at: new Date().toISOString(),
    }).eq("name", originalName);
    if (error) return alert(error.message);
    if (originalName !== name) {
      const peopleUpdate = await db.from("people").update({ group_name: name }).eq("group_name", originalName);
      if (peopleUpdate.error) return alert(peopleUpdate.error.message);
      const entryUpdate = await db.from("ledger_entries").update({ group_name: name }).eq("group_name", originalName);
      if (entryUpdate.error) return alert(entryUpdate.error.message);
    }
  } else {
    const exists = groups.find((group) => norm(group.name) === norm(name));
    if (exists) return alert("这个小组名称已经存在，请直接编辑原小组。");
    const { error } = await db.from("groups").insert({
      name,
      sort_order: sortOrder,
      color,
      active: true,
      note: "网站小组管理创建",
    });
    if (error) return alert(error.message);
  }

  resetGroupForm();
  $("groupManagerMessage").textContent = "小组已保存";
  hideModal("groupDialog");
  await loadAll();
});

$("resetPersonForm").addEventListener("click", resetPersonForm);
$("cancelGroupAction").addEventListener("click", () => hideModal("groupDialog"));
$("groupActionSelect").addEventListener("change", (event) => {
  const action = event.target.value;
  event.target.value = "";
  if (!action) return;
  if (!canEdit()) return alert("请先登录后再操作小组");
  setGroupDialogMode(action);
});
$("resetIncomeForm").addEventListener("click", resetIncomeForm);
$("rawText").addEventListener("input", () => updatePreview("rawText", "itemName", "recognitionPreview"));
$("amount").addEventListener("input", () => updatePreview("rawText", "itemName", "recognitionPreview"));
$("editRawText").addEventListener("input", () => updatePreview("editRawText", "editItemName", "editPreview"));
$("editAmount").addEventListener("input", () => updatePreview("editRawText", "editItemName", "editPreview"));
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

populateGroupSelects();
$("entryDate").value = today();
$("incomeDate").value = today();
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
