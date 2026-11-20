/**
 * IFB MANUFACTURING SCHEDULING PORTAL
 * Production Enterprise Frontend Application Script
 */

let allScheduleRows = [];
let activeCustomer = "ALL";
let analyticsRequestId = 0;

const API_BASE_URL = ["3000", "3001"].includes(window.location.port)
    ? ""
    : `${window.location.protocol}//${window.location.hostname}:3001`;

function apiUrl(path) {
    return `${API_BASE_URL}${path}`;
}

const DEFAULT_MASTER_DATA = {
    customers: [],
    catalog: {},
    varianceReasons: []
};

let activeMasterData = DEFAULT_MASTER_DATA;

// Number formatting utility (Indian numbering standard e.g. 14,000)
function formatNumber(value) {
    if (value === null || value === undefined || isNaN(value)) return "0";
    return new Intl.NumberFormat("en-IN").format(Number(value));
}

function formatPercentValue(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "N/A";
    return `${Number(value).toFixed(2)}%`;
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

// ==========================================================================
// TOAST NOTIFICATIONS
// ==========================================================================

function showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    
    let icon = "ℹ️";
    if (type === "success") icon = "✅";
    if (type === "error") icon = "❌";

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(100%)";
        toast.style.transition = "all 0.3s ease";
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ==========================================================================
// APP NAVIGATION & TAB SWITCHING
// ==========================================================================

function switchTab(tabId) {
    document.querySelectorAll(".nav-tab").forEach(tab => {
        tab.classList.toggle("active", tab.getAttribute("data-tab") === tabId);
    });

    document.querySelectorAll(".tab-pane").forEach(pane => {
        pane.classList.toggle("active", pane.id === `tab-${tabId}`);
    });

    if (tabId === "records") {
        renderMasterRecordsTable();
    }
    if (tabId === "analysis") {
        initAnalysisTab();
        refreshHistoricalAnalytics();
    }
    if (tabId === "upload") {
        loadImportedFilesList();
    }
}

// Live Clock
function startClock() {
    const clockEl = document.getElementById("liveClock");
    if (!clockEl) return;

    function update() {
        const now = new Date();
        clockEl.textContent = now.toLocaleTimeString("en-IN", { hour12: false });
    }
    update();
    setInterval(update, 1000);
}

function initializeSnapshotDate() {
    const input = document.getElementById("snapshotDate");
    if (!input || input.value) return;
    const now = new Date();
    input.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// ==========================================================================
// MASTER DATA & ENTRY FORM
// ==========================================================================

async function loadMasterData() {
    try {
        const res = await fetch(apiUrl("/master-data"));
        if (res.ok) {
            activeMasterData = await res.json();
            const statusEl = document.getElementById("backendStatusText");
            if (statusEl) statusEl.textContent = "System Online | Connected";
        }
    } catch (err) {
        activeMasterData = DEFAULT_MASTER_DATA;
    }

    populateCustomerDropdowns();
}

function populateCustomerDropdowns() {
    const dashSelect = document.getElementById("customerSelect");
    const recordsFilter = document.getElementById("recordsCustomerFilter");
    const analysisSelect = document.getElementById("analysisCustomerSelect");

    const customers = activeMasterData.customers || [];

    if (dashSelect) {
        dashSelect.innerHTML = `<option value="ALL">All Customers (Consolidated)</option>` +
                               customers.map(c => `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`).join("");
        dashSelect.value = customers.some(c => c.name === activeCustomer) ? activeCustomer : "ALL";
    }

    if (recordsFilter) {
        recordsFilter.innerHTML = `<option value="ALL">All Customers</option>` +
                                  customers.map(c => `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`).join("");
    }

    if (analysisSelect) {
        analysisSelect.innerHTML = `<option value="ALL">All Customers</option>` +
                                   customers.map(c => `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`).join("");
        analysisSelect.value = customers.some(c => c.name === activeCustomer) ? activeCustomer : "ALL";
    }
}

// DYNAMIC MONTH GENERATOR & FORM CALCULATIONS
// ==========================================================================

function formatMonthLabel(yearMonthStr) {
    if (!yearMonthStr) return "";
    const [year, month] = yearMonthStr.split("-").map(Number);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const shortYear = String(year).slice(-2);
    return `${months[month - 1]}-${shortYear}`;
}

function displayDeliveryMonth(value) {
    return /^\d{4}-\d{2}$/.test(String(value || "")) ? formatMonthLabel(value) : value || "No month supplied";
}

function displayActualMonth(row) {
    const deliveryMonth = String(row.deliveryMonth || "").trim();
    if (/\d{4}/.test(deliveryMonth) && !/^[\d,.]+$/.test(deliveryMonth)) {
        const parsed = Date.parse(deliveryMonth);
        if (Number.isFinite(parsed)) {
            return new Intl.DateTimeFormat("en", {
                month: "short",
                year: "numeric",
                timeZone: "UTC"
            }).format(new Date(parsed));
        }
    }

    const referenceMonth = row.referenceMonth || (row.importedAt ? row.importedAt.slice(0, 7) : "");
    return referenceMonth ? displayDeliveryMonth(referenceMonth) : "No month supplied";
}

function displayScheduleReceived(row) {
    const value = row.scheduleReceivedDate || (row.importedAt ? row.importedAt.slice(0, 10) : "");
    const parsed = Date.parse(value);
    const date = !value
        ? "-"
        : Number.isFinite(parsed)
            ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(parsed))
            : String(value);
    const receivedQuantity = row.scheduleReceivedQty === null || row.scheduleReceivedQty === undefined || row.scheduleReceivedQty === ""
        ? row.currentMonth ?? row.customerSchedule
        : row.scheduleReceivedQty;
    const quantity = receivedQuantity === null || receivedQuantity === undefined || receivedQuantity === ""
        ? ""
        : ` (Qty: ${formatNumber(receivedQuantity)})`;
    return `${date}${quantity}`;
}

function formatLongMonthLabel(yearMonth) {
    if (!yearMonth) return "";
    const [year, month] = yearMonth.split("-").map(Number);
    return new Intl.DateTimeFormat("en", {
        month: "short",
        year: "numeric",
        timeZone: "UTC"
    }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function shiftYearMonth(yearMonth, offset) {
    const [year, month] = yearMonth.split("-").map(Number);
    const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getActualMonthLabel() {
    const selectedMonth = getSelectedMonthKey();
    return new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" })
        .format(new Date(`${selectedMonth}-01T00:00:00Z`));
}

function getSelectedMonthKey() {
    const monthInput = document.getElementById("dashboardMonth");
    return monthInput && /^\d{4}-\d{2}$/.test(monthInput.value)
        ? monthInput.value
        : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
}

function getPreviousMonthLabel() {
    return formatLongMonthLabel(shiftYearMonth(getSelectedMonthKey(), -1));
}

function getMonthlyScheduleQuantity(row, monthKey = getSelectedMonthKey(), fallbackValue = 0) {
    if (row.monthlySchedules && Object.prototype.hasOwnProperty.call(row.monthlySchedules, monthKey)) {
        return Number(row.monthlySchedules[monthKey]) || 0;
    }
    return Number(fallbackValue) || 0;
}

function getLatestScheduleRows(rows) {
    const latestByPart = new Map();
    const versionRank = (version) => {
        const value = String(version || "").trim();
        if (/^(current|latest|final)$/i.test(value)) return { type: 2, value: Infinity };
        const match = value.match(/^(?:v(?:ersion)?\s*)?(\d+(?:\.\d+)?)$/i);
        return match ? { type: 1, value: Number(match[1]) } : { type: 0, value };
    };

    rows.forEach((row, index) => {
        if (!row.partNo) {
            latestByPart.set(`row-${index}`, row);
            return;
        }

        const key = [
            row.customerCode || row.customer || "",
            row.partNo
        ].map(value => String(value).trim().toLowerCase()).join("|");
        const current = latestByPart.get(key);
        if (!current) {
            latestByPart.set(key, row);
            return;
        }

        const candidateVersion = versionRank(row.version);
        const currentVersion = versionRank(current.version);
        let replace = candidateVersion.type > currentVersion.type ||
            (candidateVersion.type === currentVersion.type &&
                (typeof candidateVersion.value === "number" && typeof currentVersion.value === "number"
                    ? candidateVersion.value > currentVersion.value
                    : String(candidateVersion.value).localeCompare(String(currentVersion.value), undefined, { numeric: true, sensitivity: "base" }) > 0));

        if (candidateVersion.type === currentVersion.type &&
            candidateVersion.value === currentVersion.value) {
            replace = Date.parse(row.importedAt || "") >= Date.parse(current.importedAt || "");
        }
        if (replace) latestByPart.set(key, row);
    });

    return [...latestByPart.values()];
}

function displayScheduleMonth(value) {
    const text = String(value || "").trim();
    if (!text) return "-";
    if (/^\d{4}-\d{2}$/.test(text)) return displayDeliveryMonth(text);
    const monthMatch = text.match(/^([a-z]{3,9})[-\s]+(\d{2}|\d{4})$/i);
    if (monthMatch) {
        const monthIndex = [
            "jan", "feb", "mar", "apr", "may", "jun",
            "jul", "aug", "sep", "oct", "nov", "dec"
        ].findIndex(month => month === monthMatch[1].slice(0, 3).toLowerCase());
        if (monthIndex !== -1) {
            const year = monthMatch[2].length === 2 ? Number(`20${monthMatch[2]}`) : Number(monthMatch[2]);
            return formatMonthLabel(`${year}-${String(monthIndex + 1).padStart(2, "0")}`);
        }
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed)
        ? new Intl.DateTimeFormat("en", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(parsed))
        : text;
}

function displayScheduleDate(value) {
    const text = String(value || "").trim();
    if (!text) return "-";
    const parsed = Date.parse(text);
    return Number.isFinite(parsed)
        ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(parsed))
        : text;
}

function displayMonthlySchedules(row) {
    const entries = Object.entries(row.monthlySchedules || {}).sort(([left], [right]) => left.localeCompare(right));
    if (!entries.length) return "-";
    return entries
        .map(([month, quantity]) => `${displayDeliveryMonth(month)}: ${formatNumber(quantity)}`)
        .join(" | ");
}

function updateDashboardMonthLabels() {
    const monthInput = document.getElementById("dashboardMonth");
    if (!monthInput) return;

    if (!monthInput.value) {
        const now = new Date();
        monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    }

    const selectedMonth = monthInput.value;
    if (!/^\d{4}-\d{2}$/.test(selectedMonth)) return;

    const month1Key = selectedMonth;
    const month2Key = shiftYearMonth(selectedMonth, 1);
    const month3Key = shiftYearMonth(selectedMonth, 2);

    const month1Label = formatMonthLabel(month1Key);
    const month2Label = formatMonthLabel(month2Key);
    const month3Label = formatMonthLabel(month3Key);

    const planTitle = `Monthly Plan: ${month1Label} (FIRM) and (TENTATIVE 2 months)`;
    const dashBanner = document.getElementById("dashboardPlanBanner");
    const recBanner = document.getElementById("recordsPlanBanner");
    if (dashBanner) dashBanner.textContent = planTitle;
    if (recBanner) recBanner.textContent = planTitle;

    const snapM1 = document.getElementById("snapshotMonth1Label");
    const snapM2 = document.getElementById("snapshotMonth2Label");
    const snapM3 = document.getElementById("snapshotMonth3Label");
    if (snapM1) snapM1.textContent = month1Label;
    if (snapM2) snapM2.textContent = month2Label;
    if (snapM3) snapM3.textContent = month3Label;

    const recM1 = document.getElementById("recordsMonth1Label");
    const recM2 = document.getElementById("recordsMonth2Label");
    const recM3 = document.getElementById("recordsMonth3Label");
    if (recM1) recM1.textContent = month1Label;
    if (recM2) recM2.textContent = month2Label;
    if (recM3) recM3.textContent = month3Label;

    const labels = {
        previous: formatLongMonthLabel(shiftYearMonth(selectedMonth, -1)),
        current: formatLongMonthLabel(selectedMonth),
        coming: formatLongMonthLabel(shiftYearMonth(selectedMonth, 1))
    };

    [
        ["previousMonthLabel", labels.previous],
        ["currentMonthLabel", labels.current],
        ["comingMonthLabel", labels.coming],
        ["actualDispatchLabel", labels.previous],
        ["backlogLabel", `Backlog (${labels.previous})`]
    ].forEach(([id, label]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = label;
    });
    renderDashboardForCustomer(activeCustomer);
    renderMasterRecordsTable();
}

function updateDashboardKpiStrip(achievement) {
    const bar = document.getElementById("dashboardAchievementBar");
    const text = document.getElementById("dashboardAchievementText");

    const pct = Math.min(Math.max(achievement, 0), 100);
    if (bar) bar.style.width = pct + "%";
    if (text) text.textContent = achievement.toFixed(2) + "%";
}

async function refreshHistoricalAnalytics() {
    const requestId = ++analyticsRequestId;
    const month = getSelectedMonthKey();
    const customer = activeCustomer || "ALL";
    const analysisMonth = document.getElementById("analysisMonth");
    const analysisCustomer = document.getElementById("analysisCustomerSelect");
    const previousSelect = document.getElementById("wapePreviousSnapshot");
    const currentSelect = document.getElementById("wapeCurrentSnapshot");
    if (analysisMonth) analysisMonth.value = month;
    if (analysisCustomer) analysisCustomer.value = customer;

    try {
        const timelineQuery = new URLSearchParams({ month, customer });
        const timelineResponse = await fetch(apiUrl(`/analytics/snapshots?${timelineQuery}`));
        if (!timelineResponse.ok) throw new Error(`Snapshot timeline request failed (HTTP ${timelineResponse.status}).`);
        const timelineData = await timelineResponse.json();
        if (requestId !== analyticsRequestId) return;

        const timeline = timelineData.snapshots || [];
        const available = timeline.filter(snapshot => snapshot.hasDemand);
        const distinctAvailable = available.filter(snapshot => !snapshot.duplicateOfPrevious);
        const oldPrevious = previousSelect?.value || "";
        const oldCurrent = currentSelect?.value || "";
        const validIds = new Set(available.map(snapshot => snapshot.snapshotId));
        const defaultPrevious = distinctAvailable.length >= 2 ? distinctAvailable[distinctAvailable.length - 2].snapshotId : "";
        const defaultCurrent = distinctAvailable.length >= 2 ? distinctAvailable[distinctAvailable.length - 1].snapshotId : "";
        const previousId = validIds.has(oldPrevious) ? oldPrevious : defaultPrevious;
        const currentId = validIds.has(oldCurrent) ? oldCurrent : defaultCurrent;

        const populateTimelineSelect = (select, placeholder, selectedId) => {
            if (!select) return;
            select.innerHTML = `<option value="">${placeholder}</option>` + timeline.map(snapshot => {
                const captured = new Date(snapshot.capturedAt);
                const dateLabel = snapshot.snapshotDate || (Number.isFinite(captured.getTime())
                    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(captured)
                    : "");
                const duplicateLabel = snapshot.duplicateOfPrevious ? " · unchanged from previous upload" : "";
                const label = `${dateLabel} · ${snapshot.source || "Excel upload"}${snapshot.hasDemand ? ` · ${snapshot.demandRows} rows${duplicateLabel}` : " · no data for month/customer"}`;
                return `<option value="${escapeHTML(snapshot.snapshotId)}"${snapshot.hasDemand ? "" : " disabled"}>${escapeHTML(label)}</option>`;
            }).join("");
            select.value = selectedId;
        };
        populateTimelineSelect(previousSelect, "Select earlier snapshot", previousId);
        populateTimelineSelect(currentSelect, "Select later snapshot", currentId);

        const query = new URLSearchParams({ month, customer });
        if (previousId && currentId) {
            query.set("previousSnapshotId", previousId);
            query.set("currentSnapshotId", currentId);
        }
        const response = await fetch(apiUrl(`/analytics/historical?${query}`));
        if (!response.ok) throw new Error(`Analytics request failed (HTTP ${response.status}).`);
        const analytics = await response.json();
        if (requestId !== analyticsRequestId) return;

        const wapeValue = document.getElementById("analysisWapeValue");
        const wapeDetail = document.getElementById("analysisWapeDetail");
        const quantityValue = document.getElementById("analysisOnTimeQuantity");
        const quantityDetail = document.getElementById("analysisOnTimeQuantityDetail");
        const lineValue = document.getElementById("analysisOnTimeLine");
        const lineDetail = document.getElementById("analysisOnTimeLineDetail");
        const scopeLabel = document.getElementById("analysisScopeLabel");
        const readiness = document.getElementById("analysisReadiness");
        const revisionRows = document.getElementById("demandRevisionRows");
        const executionRows = document.getElementById("companyExecutionRows");
        const scopeCustomer = customer === "ALL" ? "All Customers" : customer;
        if (scopeLabel) scopeLabel.textContent = scopeCustomer;

        if (wapeValue) {
            wapeValue.textContent = formatPercentValue(analytics.demandRevisionWape?.value);
        }
        if (wapeDetail) {
            const wape = analytics.demandRevisionWape;
            wapeDetail.textContent = wape.status === "needs_two_snapshots"
                ? "Select two dated uploads containing demand for this delivery month"
                : wape.status === "select_two_snapshots"
                    ? "Choose two different uploads"
                    : wape.status === "snapshots_out_of_order"
                        ? "Choose the earlier upload first"
                        : wape.status === "snapshot_has_no_month_data"
                            ? "One selected upload has no demand for this month/customer"
                : wape.status === "zero_latest_demand"
                    ? "Latest demand is zero"
                    : wape.status === "available"
                        ? `${wape.previousSnapshotDate} (${wape.previousSource}) → ${wape.latestSnapshotDate} (${wape.latestSource})`
                        : "Demand history unavailable";
        }
        if (revisionRows) {
            const revisions = analytics.demandRevisionWape.revisions || [];
            revisionRows.innerHTML = revisions.length
                ? revisions.map(revision => `
                    <tr>
                        <td>${escapeHTML(revision.customer)}</td>
                        <td>${escapeHTML(revision.partNo)}</td>
                        <td>${formatNumber(revision.previousDemand)}</td>
                        <td>${formatNumber(revision.latestDemand)}</td>
                        <td>${revision.change > 0 ? "+" : ""}${formatNumber(revision.change)}</td>
                    </tr>
                `).join("")
                : `<tr><td colspan="5">${["needs_two_snapshots", "select_two_snapshots"].includes(analytics.demandRevisionWape.status)
                    ? "Select two different dated uploads that contain this delivery month."
                    : analytics.demandRevisionWape.status === "snapshots_out_of_order"
                        ? "Select the older upload as the earlier snapshot and the newer upload as the later snapshot."
                    : analytics.demandRevisionWape.status === "available"
                        ? "No customer demand revisions found between these uploads."
                        : "Demand changes are not available for this month."}</td></tr>`;
        }

        const onTime = analytics.onTime;
        const onTimeText = onTime.status === "due_date_not_passed"
            ? "Due at month-end"
            : onTime.status === "snapshot_before_due_date"
                ? "Upload a post-month-end snapshot"
                : onTime.status === "no_month_aligned_commitments"
                    ? "No month-aligned company commitment"
                    : onTime.status === "missing_dispatch_dates"
                        ? "Dispatch date missing for one or more committed parts"
                        : onTime.status === "missing_dispatch_quantities"
                            ? "Dispatch quantity missing for one or more commitments"
                            : onTime.status === "zero_commitment"
                                ? "No committed quantity"
                                : onTime.status === "available"
                                    ? `${formatNumber(onTime.onTimeQty)} of ${formatNumber(onTime.committedQty)} committed units on time`
                                    : "Unavailable";

        if (quantityValue) {
            quantityValue.textContent = formatPercentValue(onTime?.quantityRate);
        }
        if (quantityDetail) quantityDetail.textContent = onTimeText;
        if (lineValue) {
            lineValue.textContent = formatPercentValue(onTime?.lineRate);
        }
        if (lineDetail) {
            lineDetail.textContent = onTime.status === "available"
                ? `${formatNumber(onTime.onTimeLines)} of ${formatNumber(onTime.commitmentLines)} committed part lines fully on time`
                : onTimeText;
        }
        if (executionRows) {
            const issues = onTime.issues || [];
            executionRows.innerHTML = issues.length
                ? issues.map(issue => `
                    <tr>
                        <td>${escapeHTML(issue.customer)}</td>
                        <td>${escapeHTML(issue.partNo)}</td>
                        <td>${escapeHTML(issue.type)}</td>
                        <td>${formatNumber(issue.committedQty)}</td>
                        <td>${issue.dispatchedQty === null ? "Missing" : formatNumber(issue.dispatchedQty)}</td>
                        <td>${escapeHTML(issue.dispatchDate || "Missing")}</td>
                    </tr>
                `).join("")
                : `<tr><td colspan="6">${onTime.status === "available"
                    ? "No short or late dispatch gaps found in the selected month."
                    : "Execution gaps cannot be identified until commitment, dispatch quantity, and dispatch date are available."}</td></tr>`;
        }

        if (readiness) {
            const wapeStatus = analytics.demandRevisionWape.status;
            const executionIsAvailable = onTime.status === "available";
            const issues = onTime.issues || [];
            const executionGaps = issues.filter(issue => /short dispatch|late dispatch/i.test(issue.type));
            const missingEvidence = issues.filter(issue => /^missing /i.test(issue.type));
            if (wapeStatus !== "available" && !executionIsAvailable) {
                readiness.textContent = `${wapeStatus === "needs_two_snapshots"
                    ? "Select two dated uploads containing this delivery month."
                    : "WAPE is unavailable for the selected snapshots."} On-time is not assessable because ${onTimeText.toLowerCase()}; commitment and dispatch evidence is needed.`;
            } else if (!executionIsAvailable) {
                readiness.textContent = `WAPE is ${Number.isFinite(analytics.demandRevisionWape.value) ? `${analytics.demandRevisionWape.value.toFixed(2)}% for the selected snapshots` : "unavailable for the selected snapshots"}. On-time is not assessable because ${onTimeText.toLowerCase()}; missing evidence is not proof of a company mistake.`;
                if (executionGaps.length) {
                    readiness.textContent += ` ${executionGaps.length} short/late item(s) are listed for review`;
                    if (missingEvidence.length) readiness.textContent += ` alongside ${missingEvidence.length} missing-evidence item(s)`;
                    readiness.textContent += ".";
                }
            } else if (executionGaps.length) {
                readiness.textContent = `${executionGaps.length} potential short/late execution gap(s) found against recorded commitments. Confirm root cause; demand revisions are shown separately and are not company performance errors.`;
            } else {
                readiness.textContent = "On-time performance is assessable from the selected month’s commitment and dispatch evidence. No short or late dispatch gaps were found.";
            }
        }
    } catch (error) {
        if (requestId !== analyticsRequestId) return;
        console.error("Unable to load historical schedule analytics:", error);
        ["analysisWapeValue", "analysisOnTimeQuantity", "analysisOnTimeLine"].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.textContent = "Error";
        });
        ["analysisWapeDetail", "analysisOnTimeQuantityDetail", "analysisOnTimeLineDetail"].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.textContent = "Analytics could not be loaded";
        });
        const readiness = document.getElementById("analysisReadiness");
        if (readiness) readiness.textContent = "Analysis data could not be loaded. Check the backend and try again.";
    }
}

// ==========================================================================
// STREAMLINED SCHEDULE & PLAN ANALYSIS CENTER
// ==========================================================================

let currentStreamlinedMode = "same"; // "same" or "diff"
let currentComparisonRows = [];
let currentComparisonFilter = "all";

function selectStreamlinedMode(mode) {
    currentStreamlinedMode = mode;
    document.getElementById("tabBtnSame")?.classList.toggle("active", mode === "same");
    document.getElementById("tabBtnDiff")?.classList.toggle("active", mode === "diff");

    const pSame = document.getElementById("panelControlsSame");
    const pDiff = document.getElementById("panelControlsDiff");
    if (pSame) pSame.style.display = mode === "same" ? "block" : "none";
    if (pDiff) pDiff.style.display = mode === "diff" ? "block" : "none";

    runStreamlinedAnalysis();
}

function onSameViewModeChange() {
    const view = document.getElementById("sameViewMode")?.value || "metrics";
    const metricWrap = document.getElementById("sameMetricMonthWrap");
    const monthAWrap = document.getElementById("sameMonthAWrap");
    const monthBWrap = document.getElementById("sameMonthBWrap");

    if (view === "metrics") {
        if (metricWrap) metricWrap.style.display = "flex";
        if (monthAWrap) monthAWrap.style.display = "none";
        if (monthBWrap) monthBWrap.style.display = "none";
    } else {
        if (metricWrap) metricWrap.style.display = "none";
        if (monthAWrap) monthAWrap.style.display = "flex";
        if (monthBWrap) monthBWrap.style.display = "flex";
    }

    runStreamlinedAnalysis();
}

async function onSameSheetChange() {
    const sel = document.getElementById("sameSheetSelect");
    if (!sel || !sel.value) return;
    await loadComparisonMeta(sel.value);
    runStreamlinedAnalysis();
}

function swapComparisonSheets() {
    const baseSel = document.getElementById("baseSheetSelect");
    const compSel = document.getElementById("compareSheetSelect");
    if (!baseSel || !compSel) return;
    const temp = baseSel.value;
    baseSel.value = compSel.value;
    compSel.value = temp;
    runStreamlinedAnalysis();
}

async function initAnalysisTab() {
    await loadComparisonMeta();
    runStreamlinedAnalysis();
}

async function loadComparisonMeta(selectedSnapshotId) {
    try {
        const url = selectedSnapshotId
            ? `/analytics/comparison-meta?snapshotId=${encodeURIComponent(selectedSnapshotId)}`
            : "/analytics/comparison-meta";
        const res = await fetch(apiUrl(url));
        if (!res.ok) throw new Error("Failed to load comparison metadata.");
        const meta = await res.json();

        const baseSel = document.getElementById("baseSheetSelect");
        const compSel = document.getElementById("compareSheetSelect");
        const sameSel = document.getElementById("sameSheetSelect");
        const diffMonthSel = document.getElementById("diffMonthSelect");
        const diffCustSel = document.getElementById("diffCustomerSelect");
        const sameMonthA = document.getElementById("sameMonthA");
        const sameMonthB = document.getElementById("sameMonthB");
        const sameMetricMonth = document.getElementById("sameMetricMonth");
        const sameCustSel = document.getElementById("sameCustomerSelect");

        const snapshots = meta.snapshots || [];

        const formatSnapOption = s => {
            const label = `${s.date || ""} · ${s.source || "Sheet"} (${s.rowCount || 0} rows)`;
            return `<option value="${escapeHTML(s.snapshotId)}">${escapeHTML(label)}</option>`;
        };

        if (snapshots.length === 0) {
            const emptyOpt = `<option value="">No Excel sheets uploaded</option>`;
            if (baseSel) baseSel.innerHTML = emptyOpt;
            if (compSel) compSel.innerHTML = emptyOpt;
            if (sameSel) sameSel.innerHTML = emptyOpt;
            return meta;
        }

        const optionsHtml = snapshots.map(formatSnapOption).join("");
        const oldBase = baseSel?.value;
        const oldComp = compSel?.value;
        const oldSame = sameSel?.value;

        if (sameSel) {
            sameSel.innerHTML = optionsHtml;
            if (selectedSnapshotId && snapshots.some(s => s.snapshotId === selectedSnapshotId)) {
                sameSel.value = selectedSnapshotId;
            } else if (oldSame && snapshots.some(s => s.snapshotId === oldSame)) {
                sameSel.value = oldSame;
            } else {
                sameSel.value = snapshots[0].snapshotId;
            }
        }

        if (baseSel) {
            baseSel.innerHTML = optionsHtml;
            if (oldBase && snapshots.some(s => s.snapshotId === oldBase)) {
                baseSel.value = oldBase;
            } else if (snapshots.length >= 2) {
                baseSel.value = snapshots[0].snapshotId;
            } else {
                baseSel.value = snapshots[0].snapshotId;
            }
        }

        if (compSel) {
            compSel.innerHTML = optionsHtml;
            if (oldComp && snapshots.some(s => s.snapshotId === oldComp)) {
                compSel.value = oldComp;
            } else if (snapshots.length >= 2) {
                compSel.value = snapshots[1].snapshotId;
            } else {
                compSel.value = snapshots[0].snapshotId;
            }
        }

        const months = meta.availableMonths || [];
        const allMonths = meta.allMonths || months;
        const diffMonthOpts = `<option value="ALL">All Months</option>` +
            allMonths.map(m => `<option value="${escapeHTML(m)}">${formatMonthLabel(m)} (${m})</option>`).join("");

        if (diffMonthSel) diffMonthSel.innerHTML = diffMonthOpts;

        if (sameMetricMonth) {
            sameMetricMonth.innerHTML = `<option value="ALL">All Months</option>` +
                months.map(m => `<option value="${escapeHTML(m)}">${formatMonthLabel(m)} (${m})</option>`).join("");
            if (months.length > 0) sameMetricMonth.value = months[0];
        }

        if (sameMonthA) {
            sameMonthA.innerHTML = months.map(m => `<option value="${escapeHTML(m)}">${formatMonthLabel(m)} (${m})</option>`).join("");
            if (months.length > 0) sameMonthA.value = months[0];
        }
        if (sameMonthB) {
            sameMonthB.innerHTML = months.map(m => `<option value="${escapeHTML(m)}">${formatMonthLabel(m)} (${m})</option>`).join("");
            if (months.length > 1) sameMonthB.value = months[1];
            else if (months.length > 0) sameMonthB.value = months[0];
        }

        const customers = meta.availableCustomers || [];
        const allCustomers = meta.allCustomers || customers;
        const diffCustOpts = `<option value="ALL">All Customers</option>` +
            allCustomers.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");
        if (diffCustSel) diffCustSel.innerHTML = diffCustOpts;

        const sameCustOpts = `<option value="ALL">All Customers</option>` +
            customers.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");
        if (sameCustSel) sameCustSel.innerHTML = sameCustOpts;

        return meta;
    } catch (err) {
        console.error("loadComparisonMeta error:", err);
    }
}

async function runStreamlinedAnalysis() {
    if (currentStreamlinedMode === "same") {
        await runSameSheetStreamlined();
    } else {
        await runDiffSheetsStreamlined();
    }
}

async function runSameSheetStreamlined() {
    const snapshotId = document.getElementById("sameSheetSelect")?.value;
    const view = document.getElementById("sameViewMode")?.value || "metrics";
    const monthA = document.getElementById("sameMonthA")?.value;
    const monthB = document.getElementById("sameMonthB")?.value;
    const metricMonth = document.getElementById("sameMetricMonth")?.value || "ALL";
    const customer = document.getElementById("sameCustomerSelect")?.value || "ALL";

    const takeawayEl = document.getElementById("analysisTakeawayText");
    const tbody = document.getElementById("comparisonTableBody");

    if (!snapshotId) {
        if (takeawayEl) takeawayEl.textContent = "Please upload an Excel workbook in the 'Excel Bulk Import' tab to begin analysis.";
        if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #64748b; padding: 24px;">No Excel sheets uploaded yet.</td></tr>`;
        return;
    }

    try {
        const query = new URLSearchParams({
            snapshotId,
            mode: view,
            monthA: monthA || "",
            monthB: monthB || "",
            metricA: "commitment",
            metricB: "dispatch",
            month: metricMonth,
            customer
        });
        const res = await fetch(apiUrl(`/analytics/compare-within-sheet?${query}`));
        if (!res.ok) throw new Error("Analysis request failed.");
        const data = await res.json();

        if (data.status !== "available") {
            if (takeawayEl) takeawayEl.textContent = data.message || "No data available for this selection.";
            if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #64748b; padding: 24px;">${escapeHTML(data.message)}</td></tr>`;
            return;
        }

        if (takeawayEl) takeawayEl.textContent = data.summary.takeaway;

        if (view === "metrics") {
            updateCard("card1Title", "Planned / Committed");
            updateCard("card1Value", formatNumber(data.summary.totalA));
            updateCard("card1Detail", `Committed Units (${data.monthLabel})`);

            updateCard("card2Title", "Actual Dispatched");
            updateCard("card2Value", formatNumber(data.summary.totalB));
            updateCard("card2Detail", `Shipped Units (${data.monthLabel})`);

            const diff = data.summary.netDiff;
            updateCard("card3Title", "Delivery Shortfall");
            updateCard("card3Value", diff < 0 ? `-${formatNumber(Math.abs(diff))}` : (diff > 0 ? `+${formatNumber(diff)}` : "0"));
            updateCard("card3Detail", diff < 0 ? `Shortfall: ${formatNumber(data.summary.shortfallQty)} units` : "Fully met plan");

            updateCard("card4Title", "Fulfillment Rate");
            updateCard("card4Value", `${data.summary.fulfillmentRate.toFixed(1)}%`);
            updateCard("card4Detail", `${data.summary.partsFulfilled} of ${data.summary.partsTotal} parts on target`);

            const titleEl = document.getElementById("comparisonTableTitle");
            const subEl = document.getElementById("comparisonTableSubtitle");
            if (titleEl) titleEl.textContent = `Plan vs Dispatch: ${data.sheet.source} (${data.monthLabel})`;
            if (subEl) subEl.textContent = `Fulfillment and dispatch shortfalls for ${customer === "ALL" ? "All Customers" : customer}`;

            setTableHeader("Committed Qty", "Dispatched Qty", "Difference", "Fulfillment %");

            updateCountPill("countPillAll", data.summary.partsTotal);
            updateCountPill("countPillInc", data.summary.partsSurplus);
            updateCountPill("countPillDec", data.summary.partsShortfall);
            updateCountPill("countPillUnchanged", data.summary.partsFulfilled);
        } else {
            updateCard("card1Title", `${data.labelA} Demand`);
            updateCard("card1Value", formatNumber(data.summary.totalA));
            updateCard("card1Detail", `Baseline Month Total`);

            updateCard("card2Title", `${data.labelB} Demand`);
            updateCard("card2Value", formatNumber(data.summary.totalB));
            updateCard("card2Detail", `Comparison Month Total`);

            const netSign = data.summary.netChange >= 0 ? "+" : "";
            const pctSign = data.summary.percentChange >= 0 ? "+" : "";
            updateCard("card3Title", "Volume Ramp / Shift");
            updateCard("card3Value", `${netSign}${formatNumber(data.summary.netChange)}`);
            updateCard("card3Detail", `${pctSign}${data.summary.percentChange.toFixed(1)}% demand shift`);

            updateCard("card4Title", "Parts Ramped Up / Down");
            updateCard("card4Value", `↑${data.summary.partsIncreased} / ↓${data.summary.partsDecreased}`);
            updateCard("card4Detail", `${data.summary.partsUnchanged} parts unchanged`);

            const titleEl = document.getElementById("comparisonTableTitle");
            const subEl = document.getElementById("comparisonTableSubtitle");
            if (titleEl) titleEl.textContent = `Horizon Comparison: ${data.labelA} vs ${data.labelB} (${data.sheet.source})`;
            if (subEl) subEl.textContent = `Volume shifts across delivery months in the same sheet`;

            setTableHeader(`${data.labelA} Qty`, `${data.labelB} Qty`, "Difference (±)", "% Shift");

            updateCountPill("countPillAll", data.summary.partsTotal);
            updateCountPill("countPillInc", data.summary.partsIncreased);
            updateCountPill("countPillDec", data.summary.partsDecreased);
            updateCountPill("countPillUnchanged", data.summary.partsUnchanged);
        }

        currentComparisonRows = data.rows || [];
        renderComparisonTable();
    } catch (err) {
        console.error("runSameSheetStreamlined error:", err);
        if (takeawayEl) takeawayEl.textContent = "Error: " + err.message;
    }
}

async function runDiffSheetsStreamlined() {
    const baseSnapshotId = document.getElementById("baseSheetSelect")?.value;
    const compareSnapshotId = document.getElementById("compareSheetSelect")?.value;
    const month = document.getElementById("diffMonthSelect")?.value || "ALL";
    const customer = document.getElementById("diffCustomerSelect")?.value || "ALL";

    const takeawayEl = document.getElementById("analysisTakeawayText");
    const tbody = document.getElementById("comparisonTableBody");

    if (!baseSnapshotId || !compareSnapshotId || baseSnapshotId === compareSnapshotId) {
        if (takeawayEl) takeawayEl.textContent = "Please select two different Excel workbooks to compare.";
        if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #64748b; padding: 24px;">Please select two different Excel workbooks. If you only have one file, use the 'Analyze Within 1 Excel Sheet' tab.</td></tr>`;
        return;
    }

    try {
        const query = new URLSearchParams({ baseSnapshotId, compareSnapshotId, month, customer });
        const res = await fetch(apiUrl(`/analytics/compare-different-sheets?${query}`));
        if (!res.ok) throw new Error("Comparison request failed.");
        const data = await res.json();

        if (data.status !== "available") {
            if (takeawayEl) takeawayEl.textContent = data.message || "Comparison unavailable.";
            if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #64748b; padding: 24px;">${escapeHTML(data.message)}</td></tr>`;
            return;
        }

        if (takeawayEl) takeawayEl.textContent = data.summary.takeaway;

        updateCard("card1Title", `Base: ${data.baseSheet.source}`);
        updateCard("card1Value", formatNumber(data.summary.baseTotal));
        updateCard("card1Detail", `Baseline Demand (${data.monthLabel})`);

        updateCard("card2Title", `Compare: ${data.compareSheet.source}`);
        updateCard("card2Value", formatNumber(data.summary.compareTotal));
        updateCard("card2Detail", `Revised Demand (${data.monthLabel})`);

        const netSign = data.summary.netChange >= 0 ? "+" : "";
        const pctSign = data.summary.percentChange >= 0 ? "+" : "";
        updateCard("card3Title", "Net Volume Shift");
        updateCard("card3Value", `${netSign}${formatNumber(data.summary.netChange)}`);
        updateCard("card3Detail", `${pctSign}${data.summary.percentChange.toFixed(1)}% vs baseline`);

        updateCard("card4Title", "Demand Volatility (WAPE)");
        updateCard("card4Value", `${data.summary.wape.toFixed(2)}%`);
        updateCard("card4Detail", data.summary.stabilityLabel);

        const titleEl = document.getElementById("comparisonTableTitle");
        const subEl = document.getElementById("comparisonTableSubtitle");
        if (titleEl) titleEl.textContent = `Revision Comparison: ${data.baseSheet.source} ➔ ${data.compareSheet.source}`;
        if (subEl) subEl.textContent = `Detailed part-level variances for ${data.monthLabel} (${customer === "ALL" ? "All Customers" : customer})`;

        setTableHeader("Base Qty", "Compare Qty", "Difference (±)", "% Change");

        updateCountPill("countPillAll", data.summary.partsTotal);
        updateCountPill("countPillInc", data.summary.partsIncreased);
        updateCountPill("countPillDec", data.summary.partsDecreased);
        updateCountPill("countPillUnchanged", data.summary.partsUnchanged);

        currentComparisonRows = data.rows || [];
        renderComparisonTable();
    } catch (err) {
        console.error("runDiffSheetsStreamlined error:", err);
        if (takeawayEl) takeawayEl.textContent = "Error: " + err.message;
    }
}

function setTableHeader(colBase, colCompare, colDiff, colPct) {
    const thBase = document.getElementById("thColBase");
    const thComp = document.getElementById("thColCompare");
    const thDiff = document.getElementById("thColDiff");
    const thPct = document.getElementById("thColPct");
    if (thBase) thBase.textContent = colBase;
    if (thComp) thComp.textContent = colCompare;
    if (thDiff) thDiff.textContent = colDiff;
    if (thPct) thPct.textContent = colPct;
}

function updateCard(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function updateCountPill(id, count) {
    const el = document.getElementById(id);
    if (el) el.textContent = formatNumber(count || 0);
}

function setComparisonStatusFilter(status) {
    currentComparisonFilter = status;
    document.querySelectorAll("#comparisonFilterPills .chip-filter").forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-filter") === status);
    });
    renderComparisonTable();
}

function filterComparisonTable() {
    renderComparisonTable();
}

function renderComparisonTable() {
    const tbody = document.getElementById("comparisonTableBody");
    const searchInput = document.getElementById("comparisonSearchInput");
    if (!tbody) return;

    const query = (searchInput?.value || "").toLowerCase().trim();
    const filter = currentComparisonFilter;

    let filtered = currentComparisonRows;

    if (filter !== "all") {
        filtered = filtered.filter(row => {
            if (filter === "increased") return row.status === "increased" || row.status === "surplus" || row.status === "added";
            if (filter === "decreased") return row.status === "decreased" || row.status === "shortfall" || row.status === "removed";
            if (filter === "unchanged") return row.status === "unchanged" || row.status === "fulfilled";
            return true;
        });
    }

    if (query) {
        filtered = filtered.filter(row =>
            (row.customer || "").toLowerCase().includes(query) ||
            (row.partNo || "").toLowerCase().includes(query) ||
            (row.customerPartNo || "").toLowerCase().includes(query) ||
            (row.productDescription || "").toLowerCase().includes(query) ||
            (row.line || "").toLowerCase().includes(query)
        );
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #94a3b8; padding: 24px;">No matching part records found.</td></tr>`;
        return;
    }

    const isMetricsView = currentStreamlinedMode === "same" && document.getElementById("sameViewMode")?.value === "metrics";

    tbody.innerHTML = filtered.map(row => {
        let statusBadge = "";
        let diffClass = "diff-neutral";
        const valA = row.baseQty ?? row.qtyA ?? 0;
        const valB = row.compareQty ?? row.qtyB ?? 0;
        const diff = row.change ?? row.diff ?? 0;
        const pct = row.percentChange ?? row.fulfillmentRate ?? 0;

        if (row.status === "increased") {
            statusBadge = `<span class="badge-status-inc">Increased ↑</span>`;
            diffClass = "diff-positive";
        } else if (row.status === "decreased") {
            statusBadge = `<span class="badge-status-dec">Decreased ↓</span>`;
            diffClass = "diff-negative";
        } else if (row.status === "added") {
            statusBadge = `<span class="badge-status-new">New Part ★</span>`;
            diffClass = "diff-positive";
        } else if (row.status === "removed") {
            statusBadge = `<span class="badge-status-rem">Removed ✕</span>`;
            diffClass = "diff-negative";
        } else if (row.status === "shortfall") {
            statusBadge = `<span class="badge-status-shortfall">Shortfall ⚠️</span>`;
            diffClass = "diff-negative";
        } else if (row.status === "surplus") {
            statusBadge = `<span class="badge-status-fulfilled">Surplus ✓</span>`;
            diffClass = "diff-positive";
        } else if (row.status === "fulfilled") {
            statusBadge = `<span class="badge-status-fulfilled">Fulfilled ✓</span>`;
            diffClass = "diff-neutral";
        } else {
            statusBadge = `<span class="badge-status-same">Unchanged =</span>`;
            diffClass = "diff-neutral";
        }

        const diffDisplay = diff > 0 ? `+${formatNumber(diff)}` : formatNumber(diff);
        const pctDisplay = isMetricsView
            ? `${pct.toFixed(1)}%`
            : `${diff > 0 ? "+" : ""}${pct.toFixed(1)}%`;

        return `
            <tr>
                <td><strong>${escapeHTML(row.customer)}</strong></td>
                <td><code>${escapeHTML(row.partNo)}</code></td>
                <td>${escapeHTML(row.productDescription || "-")}</td>
                <td>${escapeHTML(row.line || "-")}</td>
                <td><strong>${formatNumber(valA)}</strong></td>
                <td><strong>${formatNumber(valB)}</strong></td>
                <td class="${diffClass}">${diffDisplay}</td>
                <td class="${diffClass}">${pctDisplay}</td>
                <td>${statusBadge}</td>
            </tr>
        `;
    }).join("");
}

function exportComparisonToCSV() {
    if (!currentComparisonRows || currentComparisonRows.length === 0) {
        showToast("No comparison data available to export.", "error");
        return;
    }
    const headers = ["Customer", "Part No", "Description", "Line", "Baseline Qty", "Comparison Qty", "Difference", "Rate", "Status"];
    const rows = currentComparisonRows.map(r => [
        `"${(r.customer || "").replace(/"/g, '""')}"`,
        `"${(r.partNo || "").replace(/"/g, '""')}"`,
        `"${(r.productDescription || "").replace(/"/g, '""')}"`,
        `"${(r.line || "").replace(/"/g, '""')}"`,
        r.baseQty ?? r.qtyA ?? 0,
        r.compareQty ?? r.qtyB ?? 0,
        r.change ?? r.diff ?? 0,
        (r.percentChange ?? r.fulfillmentRate ?? 0).toFixed(2),
        `"${r.status}"`
    ]);

    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `IFB_Analysis_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Comparison report exported successfully!", "success");
}

function onAnalysisFilterChange() {
    const month = document.getElementById("analysisMonth");
    const customer = document.getElementById("analysisCustomerSelect");
    const dashboardMonth = document.getElementById("dashboardMonth");
    const dashboardCustomer = document.getElementById("customerSelect");

    if (month && /^\d{4}-\d{2}$/.test(month.value) && dashboardMonth) {
        dashboardMonth.value = month.value;
    }
    activeCustomer = customer ? customer.value : "ALL";
    if (dashboardCustomer) dashboardCustomer.value = activeCustomer;
    updateDashboardMonthLabels();
}

function onDashboardMonthChange() {
    updateDashboardMonthLabels();
    if (document.getElementById("tab-analysis")?.classList.contains("active")) {
        refreshHistoricalAnalytics();
    }
}

function onCustomerSelectChange() {
    const select = document.getElementById("customerSelect");
    activeCustomer = select ? select.value : "ALL";
    renderDashboardForCustomer(activeCustomer);
    if (document.getElementById("tab-analysis")?.classList.contains("active")) {
        refreshHistoricalAnalytics();
    }
}

function quickSelectCustomer(custName) {
    activeCustomer = custName;
    const select = document.getElementById("customerSelect");
    if (select) select.value = custName;
    renderDashboardForCustomer(custName);
}

function renderDashboardForCustomer(customer) {
    let filtered = allScheduleRows;
    let label = customer;

    if (customer === "ALL") {
        label = "All Customers (Consolidated)";
        filtered = allScheduleRows;
    } else if (customer) {
        filtered = allScheduleRows.filter(r => r.customer === customer);
        label = customer;
    }

    // 1. Customer
    const custEl = document.getElementById("dashboardCustomer");
    if (custEl) custEl.textContent = label;

    // Selected month schedule
    const currMonthTotal = filtered.reduce((s, r) =>
        s + getMonthlyScheduleQuantity(r, getSelectedMonthKey(), r.currentMonth || r.customerSchedule || 0), 0);
    const currEl = document.getElementById("currentMonth");
    if (currEl) currEl.textContent = formatNumber(currMonthTotal);

    // Previous month schedule
    const previousMonthKey = shiftYearMonth(getSelectedMonthKey(), -1);
    const previousMonthTotal = filtered.reduce((sum, row) =>
        sum + getMonthlyScheduleQuantity(row, previousMonthKey, row.previousMonth || 0), 0);
    const previousEl = document.getElementById("previousMonth");
    if (previousEl) previousEl.textContent = formatNumber(previousMonthTotal);

    const comingMonthKey = shiftYearMonth(getSelectedMonthKey(), 1);
    const comingMonthTotal = filtered.reduce((sum, row) =>
        sum + getMonthlyScheduleQuantity(row, comingMonthKey, row.comingMonth || 0), 0);
    const comingEl = document.getElementById("comingMonth");
    if (comingEl) comingEl.textContent = formatNumber(comingMonthTotal);

    // Previous month's actual dispatch
    const actualDispatchTotal = filtered.reduce((s, r) => s + (Number(r.actualDispatch) || 0), 0);
    const dispEl = document.getElementById("actualDispatch");
    if (dispEl) dispEl.textContent = formatNumber(actualDispatchTotal);

    const scheduleVariance = currMonthTotal > 0
        ? ((currMonthTotal - actualDispatchTotal) / currMonthTotal) * 100
        : 0;
    const varianceEl = document.getElementById("scheduleVariance");
    if (varianceEl) varianceEl.textContent = `${scheduleVariance.toFixed(2)}%`;

    // Backlog
    const latestRows = getLatestScheduleRows(filtered);
    const backlogRows = latestRows.filter(row =>
        row.balance !== null && row.balance !== undefined && row.balance !== "" && Number.isFinite(Number(row.balance))
    );
    const balanceTotal = backlogRows.reduce((sum, row) => sum + Number(row.balance), 0);
    const balEl = document.getElementById("balance");
    if (balEl) balEl.textContent = backlogRows.length ? formatNumber(balanceTotal) : "-";

    const month1Key = getSelectedMonthKey();
    const month2Key = shiftYearMonth(month1Key, 1);
    const month3Key = shiftYearMonth(month1Key, 2);

    // Dashboard snapshot table
    const tableBody = document.getElementById("scheduleTable");
    if (tableBody) {
        if (!filtered.length) {
            tableBody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: #94a3b8;">No schedules recorded for ${escapeHTML(label)}</td></tr>`;
        } else {
            tableBody.innerHTML = filtered.slice(0, 10).map((r, idx) => `
                <tr>
                    <td>${escapeHTML(r.serialNo || idx + 1)}</td>
                    <td><strong>${escapeHTML(r.customerGroup || r.customer || "-")}</strong></td>
                    <td>${escapeHTML(r.customerCode || "-")}</td>
                    <td>${escapeHTML(r.partNo || "-")}</td>
                    <td>${escapeHTML(r.helper || "-")}</td>
                    <td>${escapeHTML(r.customerPartNo || "-")}</td>
                    <td>${escapeHTML(r.line || "-")}</td>
                    <td>${escapeHTML(r.productDescription || "-")}</td>
                    <td><strong>${formatNumber(getMonthlyScheduleQuantity(r, month1Key, r.currentMonth || r.customerSchedule || 0))}</strong></td>
                    <td style="background: #fefce8; color: #854d0e;">${formatNumber(getMonthlyScheduleQuantity(r, month2Key, r.comingMonth || 0))}</td>
                    <td style="background: #fefce8; color: #854d0e;">${formatNumber(getMonthlyScheduleQuantity(r, month3Key, 0))}</td>
                </tr>
            `).join("");
        }
    }

    // Update KPI strip
    const suppliedAchievements = filtered
        .filter(row => row.achievement !== null && row.achievement !== undefined && row.achievement !== "")
        .map(row => Number(row.achievement))
        .filter(Number.isFinite);
    const achievement = suppliedAchievements.length
        ? suppliedAchievements.reduce((sum, value) => sum + value, 0) / suppliedAchievements.length
        : currMonthTotal > 0 ? (actualDispatchTotal / currMonthTotal) * 100 : 0;
    updateDashboardKpiStrip(achievement);
    if (document.getElementById("tab-analysis")?.classList.contains("active")) {
        refreshHistoricalAnalytics();
    }
}

// ==========================================================================
// MASTER RECORDS TABLE (FILTER, SEARCH, EXPORT, DELETE)
// ==========================================================================

function filterMasterTable() {
    renderMasterRecordsTable();
}

function renderMasterRecordsTable() {
    const tbody = document.getElementById("masterRecordsBody");
    const countEl = document.getElementById("recordCounterText");
    const searchInput = document.getElementById("tableSearchInput");
    const filterSelect = document.getElementById("recordsCustomerFilter");
    const versionSelect = document.getElementById("recordsVersionFilter");
    const monthSelect = document.getElementById("recordsMonthFilter");

    if (!tbody) return;

    const setFilterOptions = (select, label, values) => {
        if (!select) return "ALL";
        const selectedValue = select.value || "ALL";
        const options = [...new Set(values.filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b));
        select.innerHTML = `<option value="ALL">${label}</option>` +
            options.map(value => `<option value="${escapeHTML(value)}">${escapeHTML(label === "All months" ? displayDeliveryMonth(value) : value)}</option>`).join("");
        select.value = options.includes(selectedValue) ? selectedValue : "ALL";
        return select.value;
    };

    let rows = [...allScheduleRows];
    const searchTerm = (searchInput?.value || "").toLowerCase().trim();
    const custFilter = filterSelect?.value || "ALL";
    const versionFilter = setFilterOptions(versionSelect, "All versions", rows.map(row => row.version));
    const monthFilter = setFilterOptions(monthSelect, "All months", rows.map(row => row.deliveryMonth || "No month supplied"));

    if (custFilter !== "ALL") {
        rows = rows.filter(r => r.customer === custFilter);
    }
    if (versionFilter !== "ALL") {
        rows = rows.filter(r => (r.version || "Current") === versionFilter);
    }
    if (monthFilter !== "ALL") {
        rows = rows.filter(r => (r.deliveryMonth || "No month supplied") === monthFilter);
    }

    if (searchTerm) {
        rows = rows.filter(r => [
            r.serialNo, r.customer, r.customerGroup, r.customerCode,
            r.partNo, r.helper, r.customerPartNo, r.line,
            r.productDescription, r.application, r.version, r.deliveryMonth, r.source, r.importedAt
        ].some(value => String(value || "").toLowerCase().includes(searchTerm)));
    }

    if (countEl) countEl.textContent = `Showing ${rows.length} of ${allScheduleRows.length} records`;

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="16" style="text-align: center; padding: 24px; color: #94a3b8;">No schedule records match the current criteria.</td></tr>`;
        return;
    }

    const month1Key = getSelectedMonthKey();
    const month2Key = shiftYearMonth(month1Key, 1);
    const month3Key = shiftYearMonth(month1Key, 2);

    tbody.innerHTML = rows.map((r, displayIndex) => {
        const originalIndex = allScheduleRows.indexOf(r);

        return `
            <tr>
                <td>${escapeHTML(r.serialNo || displayIndex + 1)}</td>
                <td><strong>${escapeHTML(r.customerGroup || r.customer || "-")}</strong></td>
                <td>${escapeHTML(r.customerCode || "-")}</td>
                <td>${escapeHTML(r.partNo || "-")}</td>
                <td>${escapeHTML(r.helper || "-")}</td>
                <td>${escapeHTML(r.customerPartNo || "-")}</td>
                <td>${escapeHTML(r.line || "-")}</td>
                <td>${escapeHTML(r.productDescription || "-")}</td>
                <td><strong>${formatNumber(getMonthlyScheduleQuantity(r, month1Key, r.currentMonth || r.customerSchedule || 0))}</strong></td>
                <td style="background: #fefce8; color: #854d0e;">${formatNumber(getMonthlyScheduleQuantity(r, month2Key, r.comingMonth || 0))}</td>
                <td style="background: #fefce8; color: #854d0e;">${formatNumber(getMonthlyScheduleQuantity(r, month3Key, 0))}</td>
                <td>${escapeHTML(r.version || "Current")}</td>
                <td>${escapeHTML(displayScheduleReceived(r))}</td>
                <td>${formatNumber(r.actualDispatch || 0)}</td>
                <td><strong>${r.balance === null || r.balance === undefined ? "-" : formatNumber(r.balance)}</strong></td>
                <td>
                    <button class="btn-action-icon btn-delete-row" onclick="deleteScheduleRow(${originalIndex})" title="Delete entry">🗑️</button>
                </td>
            </tr>
        `;
    }).join("");
}

async function deleteScheduleRow(index) {
    if (!confirm("Are you sure you want to remove this schedule entry?")) return;

    try {
        const response = await fetch(apiUrl(`/api/schedule-row/${index}`), { method: "DELETE" });
        if (!response.ok) throw new Error("Delete request failed.");
        allScheduleRows.splice(index, 1);
    } catch (error) {
        showToast("Unable to delete the schedule row from the backend.", "error");
        return;
    }

    renderDashboardForCustomer(activeCustomer);
    renderMasterRecordsTable();
    showToast("Schedule row deleted", "info");
}

function exportRecordsToCSV() {
    if (!allScheduleRows.length) {
        showToast("No records available to export", "error");
        return;
    }

    const month1Key = getSelectedMonthKey();
    const month2Key = shiftYearMonth(month1Key, 1);
    const month3Key = shiftYearMonth(month1Key, 2);

    const headers = [
        "Sl No", "Customer", "Customer code", "PART No.", "Helper",
        "Customer Part No", "Line", "Description",
        formatMonthLabel(month1Key), formatMonthLabel(month2Key), formatMonthLabel(month3Key),
        "Version", "Schedule Received Date", "Actual Dispatch Qty", "Backlog", "Saved At", "Source"
    ];
    const csvRows = [headers.join(",")];

    allScheduleRows.forEach((r, idx) => {
        csvRows.push([
            `"${r.serialNo || idx + 1}"`,
            `"${r.customerGroup || r.customer || ''}"`,
            `"${r.customerCode || ''}"`,
            `"${r.partNo || ''}"`,
            `"${r.helper || ''}"`,
            `"${r.customerPartNo || ''}"`,
            `"${r.line || ''}"`,
            `"${r.productDescription || ''}"`,
            getMonthlyScheduleQuantity(r, month1Key, r.currentMonth || r.customerSchedule || 0),
            getMonthlyScheduleQuantity(r, month2Key, r.comingMonth || 0),
            getMonthlyScheduleQuantity(r, month3Key, 0),
            `"${r.version || 'Current'}"`,
            `"${r.scheduleReceivedDate || ''}"`,
            r.actualDispatch || 0,
            r.balance === null || r.balance === undefined ? "" : formatNumber(r.balance),
            `"${r.importedAt || ''}"`,
            `"${r.source || ''}"`
        ].join(","));
    });

    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `IFB_Schedule_Export_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    showToast("Master schedule exported to CSV", "success");
}

async function loadImportedFilesList() {
    const tbody = document.getElementById("importedFilesTableBody");
    if (!tbody) return;

    try {
        const res = await fetch(apiUrl("/api/imported-files"));
        if (!res.ok) throw new Error("Failed to fetch imported files list.");
        const files = await res.json();

        if (!files.length) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 20px;">No Excel schedule files have been imported yet.</td></tr>`;
            return;
        }

        tbody.innerHTML = files.map((file, idx) => {
            const dateStr = file.capturedAt && file.capturedAt !== "-"
                ? new Date(file.capturedAt).toLocaleString("en-IN")
                : file.snapshotDate;

            return `
                <tr>
                    <td>${idx + 1}</td>
                    <td><strong>📄 ${escapeHTML(file.source || file.filename)}</strong></td>
                    <td><span class="tag">${escapeHTML(file.snapshotDate || "-")}</span></td>
                    <td>${escapeHTML(dateStr)}</td>
                    <td><span class="badge-accent">${formatNumber(file.rowCount)} rows</span></td>
                    <td style="text-align: center; white-space: nowrap;">
                        <button type="button" class="btn-action-icon" onclick="downloadImportedFile('${escapeHTML(file.snapshotId)}')" title="Download Excel File">📥</button>
                        <button type="button" class="btn-action-icon btn-delete-row" onclick="deleteImportedFile('${escapeHTML(file.snapshotId)}', '${escapeHTML(file.source || file.filename)}')" title="Delete File & Snapshot">🗑️</button>
                    </td>
                </tr>
            `;
        }).join("");
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 20px;">Error loading files: ${escapeHTML(err.message)}</td></tr>`;
    }
}

function downloadImportedFile(snapshotId) {
    window.location.href = apiUrl(`/api/download-file/${encodeURIComponent(snapshotId)}`);
}

async function deleteImportedFile(snapshotId, filename) {
    if (!confirm(`Are you sure you want to delete the imported schedule workbook "${filename}"?\nThis will remove its records from the portal.`)) {
        return;
    }

    try {
        const res = await fetch(apiUrl(`/api/imported-file/${encodeURIComponent(snapshotId)}`), {
            method: "DELETE"
        });
        if (!res.ok) throw new Error("Failed to delete snapshot.");
        const result = await res.json();
        showToast("Workbook & snapshot deleted successfully", "success");

        if (Array.isArray(result.rows)) {
            allScheduleRows = result.rows;
        } else {
            await loadDashboardData();
        }
        renderDashboardForCustomer(activeCustomer);
        renderMasterRecordsTable();
        await loadMasterData();
        loadImportedFilesList();
        await loadComparisonMeta();
        runStreamlinedAnalysis();
    } catch (err) {
        showToast(err.message, "error");
    }
}

// ==========================================================================
// EXCEL BULK UPLOAD WITH DRAG AND DROP
// ==========================================================================

function triggerFileInput() {
    const fileInput = document.getElementById("excelFile");
    if (fileInput) fileInput.click();
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    const badge = document.getElementById("selectedFileName");
    if (file && badge) {
        badge.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        badge.style.display = "inline-block";
    }
    const status = document.getElementById("uploadStatus");
    if (status) status.textContent = "";
}

function initDragAndDrop() {
    const dropZone = document.getElementById("dropZone");
    const fileInput = document.getElementById("excelFile");
    if (!dropZone || !fileInput) return;

    ["dragenter", "dragover"].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.add("dragover");
        }, false);
    });

    ["dragleave", "drop"].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.remove("dragover");
        }, false);
    });

    dropZone.addEventListener("drop", (e) => {
        const files = e.dataTransfer.files;
        if (files.length) {
            fileInput.files = files;
            handleFileSelect({ target: fileInput });
        }
    }, false);
}

async function uploadExcel() {
    const fileInput = document.getElementById("excelFile");
    const status = document.getElementById("uploadStatus");
    const uploadButton = document.getElementById("uploadButton");

    if (!fileInput || !fileInput.files.length) {
        showToast("Please choose or drop an Excel file first", "error");
        return;
    }

    const file = fileInput.files[0];
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
        const message = "Unsupported file type. Choose an .xlsx, .xls, or .csv spreadsheet.";
        if (status) {
            status.style.color = "#dc2626";
            status.textContent = message;
        }
        showToast(message, "error");
        return;
    }

    const formData = new FormData();
    formData.append("excelFile", file);
    const snapshotDate = document.getElementById("snapshotDate")?.value;
    if (snapshotDate) formData.append("snapshotDate", snapshotDate);

    if (status) {
        status.style.color = "#2563eb";
        status.textContent = "Processing and parsing spreadsheet...";
    }
    if (uploadButton) {
        uploadButton.disabled = true;
        uploadButton.textContent = "Uploading spreadsheet...";
    }

    try {
        const response = await fetch(apiUrl("/upload-excel"), { method: "POST", body: formData });
        const responseText = await response.text();
        let result;
        try {
            result = JSON.parse(responseText);
        } catch {
            if (response.status === 405) {
                throw new Error("This server does not accept spreadsheet uploads. Start the app backend and open the app through http://localhost:3001 or Live Server.");
            }
            throw new Error(`The server returned an unexpected response (HTTP ${response.status}). Please check the spreadsheet and try again.`);
        }

        if (response.ok) {
            const importedRows = Array.isArray(result.rows) ? result.rows : [];
            if (!importedRows.length) {
                if (status) {
                    status.style.color = "#d97706";
                    status.textContent = "No schedule rows were found. Fill in the template or check that the first sheet has schedule data, then try again.";
                }
                showToast("No schedule rows were found. Check the first worksheet and try again.", "error");
                return;
            }

            allScheduleRows = importedRows;
            await loadMasterData();
            activeCustomer = "ALL";
            renderDashboardForCustomer(activeCustomer);
            renderMasterRecordsTable();
            loadImportedFilesList();
            loadComparisonMeta();

            if (status) {
                status.style.color = "#059669";
                status.textContent = `${result.message} ${allScheduleRows.length} rows loaded from "${result.filename}" as snapshot dated ${result.snapshotDate || "today"}.`;
            }

            showToast("Spreadsheet uploaded and its rows are now available in the portal.", "success");
            switchTab("dashboard");
        } else {
            const message = result.message || result.error || `Upload failed (HTTP ${response.status}).`;
            if (status) {
                status.style.color = "#dc2626";
                status.textContent = message;
            }
            showToast(message, "error");
        }
    } catch (error) {
        const message = error instanceof TypeError
            ? "Could not reach the server. Check that the backend is running and try again."
            : error.message || "The spreadsheet upload failed.";
        if (status) {
            status.style.color = "#dc2626";
            status.textContent = message;
        }
        showToast(message, "error");
    } finally {
        if (uploadButton) {
            uploadButton.disabled = false;
            uploadButton.textContent = "🚀 Upload & Process Spreadsheet";
        }
    }
}

// ==========================================================================
// INITIAL DATA LOADER
// ==========================================================================

async function loadDashboardData() {
    try {
        const response = await fetch(apiUrl("/dashboard"));
        if (!response.ok) {
            throw new Error("Dashboard request failed.");
        }
        const data = await response.json();
        allScheduleRows = Array.isArray(data.rows) ? data.rows : [];
        return allScheduleRows;
    } catch (error) {
        allScheduleRows = [];
        console.error("loadDashboardData error:", error);
        showToast("Unable to fetch schedule data. Start the backend and try again.", "error");
        return [];
    }
}

async function initApplication() {
    startClock();
    initializeSnapshotDate();
    initDragAndDrop();
    updateDashboardMonthLabels();
    await loadDashboardData();

    await loadMasterData();
    activeCustomer = "ALL";
    renderDashboardForCustomer(activeCustomer);
    renderMasterRecordsTable();
    loadImportedFilesList();
    loadComparisonMeta();
    switchTab("dashboard");
}

document.addEventListener("DOMContentLoaded", initApplication);
