/**
 * IFB MANUFACTURING SCHEDULING PORTAL
 * Production Enterprise Frontend Application Script
 */

let allScheduleRows = [];
let activeCustomer = "ALL";
let analyticsRequestId = 0;
let currentCustomerActivity = null;
let currentActivityFilter = "all";
let currentCustomerConsistencyData = null;

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

let activeAnalysisSubtab = "patterns";

function switchAnalysisSubtab(subtabId) {
    activeAnalysisSubtab = subtabId;
    document.querySelectorAll(".analysis-subtab-btn").forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-subtab") === subtabId);
    });

    document.querySelectorAll(".analysis-subpane").forEach(pane => {
        pane.classList.toggle("active", pane.id === `subpane-${subtabId}`);
    });

    if (subtabId === "patterns") {
        loadCustomerConsistency();
    } else if (subtabId === "wape" || subtabId === "fulfillment") {
        refreshHistoricalAnalytics();
    }
}

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
        if (activeAnalysisSubtab === "patterns") {
            loadCustomerConsistency();
        } else {
            refreshHistoricalAnalytics();
        }
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
        const res = await fetch("/master-data");
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

function getMonthlyDispatchQuantity(row, monthKey = getSelectedMonthKey(), fallbackValue = 0) {
    if (row.monthlyDispatches && Object.prototype.hasOwnProperty.call(row.monthlyDispatches, monthKey)) {
        return Number(row.monthlyDispatches[monthKey]) || 0;
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
    const wapeMonthBadge = document.getElementById("wapeActiveDeliveryMonth");
    if (wapeMonthBadge) wapeMonthBadge.textContent = month1Label;
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
        const timelineResponse = await fetch(`/analytics/snapshots?${timelineQuery}`);
        if (!timelineResponse.ok) throw new Error(`Snapshot timeline request failed (HTTP ${timelineResponse.status}).`);
        const timelineData = await timelineResponse.json();
        if (requestId !== analyticsRequestId) return;

        const timeline = timelineData.snapshots || [];
        const available = timeline.filter(snapshot => snapshot.hasDemand);
        const distinctAvailable = available.filter(snapshot => !snapshot.duplicateOfPrevious);
        const oldPrevious = previousSelect?.value || "";
        const oldCurrent = currentSelect?.value || "";
        const validIds = new Set(timeline.map(snapshot => snapshot.snapshotId));
        const defaultPrevious = distinctAvailable.length >= 2
            ? distinctAvailable[distinctAvailable.length - 2].snapshotId
            : (timeline.length >= 2 ? timeline[0].snapshotId : "");
        const defaultCurrent = distinctAvailable.length >= 2
            ? distinctAvailable[distinctAvailable.length - 1].snapshotId
            : (timeline.length >= 1 ? timeline[timeline.length - 1].snapshotId : "");
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
                const demandNote = snapshot.hasDemand
                    ? ` · ${snapshot.demandRows} demand rows for ${formatMonthLabel(month)}${duplicateLabel}`
                    : ` · (0 rows for ${formatMonthLabel(month)})`;
                const label = `${dateLabel} · ${snapshot.source || "Excel upload"}${demandNote}`;
                return `<option value="${escapeHTML(snapshot.snapshotId)}">${escapeHTML(label)}</option>`;
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
        const response = await fetch(`/analytics/historical?${query}`);
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
        if (scopeLabel) scopeLabel.textContent = `${formatMonthLabel(month)} · ${scopeCustomer}`;

        if (wapeValue) {
            wapeValue.textContent = analytics.demandRevisionWape.value === null
                ? "N/A"
                : `${Number(analytics.demandRevisionWape.value).toFixed(2)}%`;
        }
        if (wapeDetail) {
            const wape = analytics.demandRevisionWape;
            wapeDetail.textContent = wape.status === "needs_two_snapshots"
                ? `Select two dated uploads containing demand for ${formatMonthLabel(month)}`
                : wape.status === "select_two_snapshots"
                    ? "Choose two different uploads"
                    : wape.status === "snapshots_out_of_order"
                        ? "Choose the earlier upload first"
                        : wape.status === "snapshot_has_no_month_data"
                            ? `No demand overlap for ${formatMonthLabel(month)}: ${wape.previousSource || "Earlier"} has ${wape.previousDemandRows ?? 0} rows, ${wape.latestSource || "Later"} has ${wape.latestDemandRows ?? 0} rows`
                : wape.status === "zero_latest_demand"
                    ? "Latest demand is zero"
                    : wape.status === "available"
                        ? `${wape.previousSnapshotDate} (${wape.previousSource}) → ${wape.latestSnapshotDate} (${wape.latestSource})`
                        : "Demand history unavailable";
        }

        const dispatchWapeVal = document.getElementById("analysisDispatchWapeValue");
        const dispatchWapeDet = document.getElementById("analysisDispatchWapeDetail");
        if (dispatchWapeVal) {
            dispatchWapeVal.textContent = analytics.dispatchExecutionWape?.value !== null && analytics.dispatchExecutionWape?.value !== undefined
                ? `${Number(analytics.dispatchExecutionWape.value).toFixed(2)}%`
                : "N/A";
        }
        if (dispatchWapeDet) {
            const dew = analytics.dispatchExecutionWape;
            dispatchWapeDet.textContent = dew?.status === "available"
                ? `|Dispatch - Schedule| across ${formatNumber(dew.comparedParts)} parts in ${formatMonthLabel(month)} (${dew.source || ""})`
                : `No schedule vs dispatch records for ${formatMonthLabel(month)}`;
        }

        if (revisionRows) {
            const revisions = analytics.demandRevisionWape.revisions || [];
            const wape = analytics.demandRevisionWape;
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
                : `<tr><td colspan="5" style="padding: 18px; line-height: 1.6; color: #475569;">${
                    wape.status === "snapshot_has_no_month_data"
                        ? `<div style="max-width: 680px; margin: 0 auto; text-align: left; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 14px 18px;">
                            <strong style="color: #b45309; font-size: 1.05em;">⚠️ Non-Overlapping Delivery Months for ${formatMonthLabel(month)}</strong><br>
                            <div style="margin-top: 6px; font-size: 0.95em;">
                                • Earlier upload (<em>${escapeHTML(wape.previousSource || "Earlier file")}</em>): <strong>${wape.previousDemandRows ?? 0} schedule lines</strong> for ${formatMonthLabel(month)}.<br>
                                • Later upload (<em>${escapeHTML(wape.latestSource || "Later file")}</em>): <strong>${wape.latestDemandRows ?? 0} schedule lines</strong> for ${formatMonthLabel(month)}.
                            </div>
                            <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid #fef3c7; font-size: 0.88em; color: #78350f;">
                                <strong>Why does this occur?</strong><br>
                                • <strong>'Copy of Motor Division Dispatch Data.xlsx'</strong> covers <strong>April–September 2026</strong>.<br>
                                • <strong>'Motor Monthly Plan Oct26'</strong> covers <strong>October–December 2026</strong>.<br>
                                Because these two files track different calendar quarters, they do not share demand for any single delivery month. WAPE revision comparison measures how a single month's orders changed between revisions (e.g. Oct Plan Rev-01 vs Rev-02).
                            </div>
                           </div>`
                        : ["needs_two_snapshots", "select_two_snapshots"].includes(analytics.demandRevisionWape.status)
                            ? `Select two different dated uploads that contain this delivery month (${formatMonthLabel(month)}).`
                            : analytics.demandRevisionWape.status === "snapshots_out_of_order"
                                ? "Select the older upload as the earlier snapshot and the newer upload as the later snapshot."
                                : analytics.demandRevisionWape.status === "available"
                                    ? "No customer demand revisions found between these uploads."
                                    : "Demand changes are not available for this month."
                }</td></tr>`;
        }

        const onTime = analytics.onTime;
        const fulfillment = onTime.monthlyFulfillment;
        const hasFulfillment = fulfillment && fulfillment.quantityRate !== null && fulfillment.quantityRate !== undefined && Number.isFinite(fulfillment.quantityRate);
        const onTimeText = onTime.status === "due_date_not_passed"
            ? "Due at month-end"
            : onTime.status === "snapshot_before_due_date"
                ? "Upload a post-month-end snapshot"
                : onTime.status === "no_month_aligned_commitments"
                    ? "No month-aligned company commitment"
                    : onTime.status === "missing_dispatch_dates"
                        ? (hasFulfillment ? `Assessed from monthly dispatch attainment (${formatMonthLabel(month)})` : "Dispatch date missing for one or more committed parts")
                        : onTime.status === "missing_dispatch_quantities"
                            ? "Dispatch quantity missing for one or more commitments"
                            : onTime.status === "zero_commitment"
                                ? "No committed quantity"
                                : onTime.status === "available"
                                    ? `${formatNumber(onTime.onTimeQty)} of ${formatNumber(onTime.committedQty)} committed units on time`
                                    : "Unavailable";

        if (quantityValue) {
            if (onTime.quantityRate !== null) {
                quantityValue.textContent = `${Number(onTime.quantityRate).toFixed(2)}%`;
            } else if (hasFulfillment) {
                quantityValue.textContent = `${Number(fulfillment.quantityRate).toFixed(2)}%`;
            } else {
                quantityValue.textContent = "N/A";
            }
        }
        if (quantityDetail) {
            if (onTime.quantityRate !== null) {
                quantityDetail.textContent = `${formatNumber(onTime.onTimeQty)} of ${formatNumber(onTime.committedQty)} committed units on time`;
            } else if (hasFulfillment) {
                quantityDetail.textContent = `Monthly Attainment: ${formatNumber(fulfillment.fulfilledQty)} of ${formatNumber(fulfillment.committedQty)} committed units dispatched in ${formatMonthLabel(month)}`;
            } else {
                quantityDetail.textContent = onTimeText;
            }
        }
        if (lineValue) {
            if (onTime.lineRate !== null) {
                lineValue.textContent = `${Number(onTime.lineRate).toFixed(2)}%`;
            } else if (hasFulfillment) {
                lineValue.textContent = `${Number(fulfillment.lineRate).toFixed(2)}%`;
            } else {
                lineValue.textContent = "N/A";
            }
        }
        if (lineDetail) {
            if (onTime.lineRate !== null) {
                lineDetail.textContent = `${formatNumber(onTime.onTimeLines)} of ${formatNumber(onTime.commitmentLines)} committed part lines fully on time`;
            } else if (hasFulfillment) {
                lineDetail.textContent = `${formatNumber(fulfillment.fulfilledLines)} of ${formatNumber(fulfillment.commitmentLines)} committed part lines 100% fulfilled in ${formatMonthLabel(month)}`;
            } else {
                lineDetail.textContent = onTimeText;
            }
        }
        if (executionRows) {
            const rawIssues = onTime.issues || [];
            const issues = rawIssues.filter(issue => issue.type !== "Missing dispatch date" || (issue.committedQty !== null && issue.dispatchedQty !== null && issue.committedQty > issue.dispatchedQty));
            executionRows.innerHTML = issues.length
                ? issues.map(issue => `
                    <tr>
                        <td>${escapeHTML(issue.customer)}</td>
                        <td>${escapeHTML(issue.partNo)}</td>
                        <td>${escapeHTML(issue.type === "Missing dispatch date" ? "Short dispatch" : issue.type)}</td>
                        <td>${formatNumber(issue.committedQty)}</td>
                        <td>${issue.dispatchedQty === null ? "Missing" : formatNumber(issue.dispatchedQty)}</td>
                        <td>${escapeHTML(issue.dispatchDate || formatMonthLabel(month))}</td>
                    </tr>
                `).join("")
                : `<tr><td colspan="6">${(onTime.status === "available" || hasFulfillment)
                    ? `All committed lines in ${formatMonthLabel(month)} met or exceeded dispatch targets.`
                    : "Execution gaps cannot be identified until commitment and dispatch quantity are available."}</td></tr>`;
        }

        if (readiness) {
            const wapeStatus = analytics.demandRevisionWape.status;
            const executionIsAvailable = onTime.status === "available" || hasFulfillment;
            const issues = onTime.issues || [];
            const executionGaps = issues.filter(issue => /short dispatch|late dispatch/i.test(issue.type) || (issue.type === "Missing dispatch date" && issue.committedQty > issue.dispatchedQty));
            const missingEvidence = issues.filter(issue => /^missing /i.test(issue.type) && issue.type !== "Missing dispatch date");
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
                readiness.textContent = `${executionGaps.length} short dispatch gap(s) found against recorded commitments for ${formatMonthLabel(month)}. Attainment is ${hasFulfillment ? Number(fulfillment.quantityRate).toFixed(1) + "%" : ""}.`;
            } else {
                readiness.textContent = `Delivery performance is assessable for ${formatMonthLabel(month)}. Attainment is ${hasFulfillment ? Number(fulfillment.quantityRate).toFixed(1) + "%" : "100%"}. No short dispatch gaps were found.`;
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

async function loadCustomerConsistency() {
    const customer = activeCustomer || "ALL";
    const label = document.getElementById("consistencyCustomerLabel");
    if (label) {
        label.textContent = customer === "ALL" ? "All Customers (Portfolio Overview)" : `${customer} Pattern Analysis`;
    }

    try {
        const res = await fetch(`/analytics/customer-consistency?customer=${encodeURIComponent(customer)}`);
        if (!res.ok) throw new Error(`Consistency request failed (HTTP ${res.status}).`);
        const data = await res.json();

        // 1. Consistency Score Card
        const scoreVal = document.getElementById("consistencyScoreVal");
        const badge = document.getElementById("consistencyBadge");
        const scoreDetail = document.getElementById("consistencyScoreDetail");
        const cvVal = document.getElementById("consistencyCvVal");
        const cvDetail = document.getElementById("consistencyCvDetail");
        const driftVal = document.getElementById("consistencyDriftVal");
        const driftDetail = document.getElementById("consistencyDriftDetail");
        const biasVal = document.getElementById("consistencyBiasVal");
        const biasDetail = document.getElementById("consistencyBiasDetail");
        const insightText = document.getElementById("consistencyInsightText");

        const consistency = data.consistency || {};
        if (scoreVal) scoreVal.textContent = consistency.score !== null && consistency.score !== undefined ? `${consistency.score}/100` : "--";
        if (badge) {
            badge.textContent = consistency.rating || "No Data";
            badge.className = `badge-status badge-${consistency.status || "neutral"}`;
        }
        if (scoreDetail) {
            scoreDetail.textContent = consistency.status === "consistent"
                ? "Highly predictable ordering pattern"
                : consistency.status === "moderate"
                    ? "Normal operational demand variation"
                    : consistency.status === "volatile"
                        ? "High demand fluctuation across months"
                        : consistency.status === "erratic"
                            ? "Erratic / unforecastable swings"
                            : "Upload schedule to compute score";
        }

        // 2. Volatility CV
        if (cvVal) cvVal.textContent = consistency.cv !== undefined ? Number(consistency.cv).toFixed(3) : "--";
        if (cvDetail) {
            cvDetail.textContent = consistency.mean
                ? `Monthly Mean: ${formatNumber(consistency.mean)} units (σ = ${formatNumber(consistency.stdDev)})`
                : "Lower CV indicates stable demand";
        }

        // 3. Horizon Drift
        const horizon = data.horizonDrift || {};
        if (driftVal) {
            driftVal.textContent = horizon.averageDriftPct !== null && horizon.averageDriftPct !== undefined
                ? `${horizon.averageDriftPct > 0 ? "+" : ""}${Number(horizon.averageDriftPct).toFixed(1)}%`
                : "--";
        }
        if (driftDetail) {
            driftDetail.textContent = horizon.evaluatedMonthsCount
                ? `Evaluated over ${horizon.evaluatedMonthsCount} multi-snapshot delivery cycles`
                : "Needs 2+ dated uploads for same month";
        }

        // 4. Bias
        if (biasVal) {
            biasVal.textContent = horizon.biasPct !== null && horizon.biasPct !== undefined
                ? `${horizon.biasPct > 0 ? "+" : ""}${Number(horizon.biasPct).toFixed(1)}%`
                : "--";
        }
        if (biasDetail) {
            biasDetail.textContent = horizon.biasType || "Systematic order drift direction";
        }

        // 5. Narrative insight
        if (insightText) {
            insightText.textContent = data.insight || "No pattern insight generated.";
        }

        // 6. Horizon Drift Table
        const driftTable = document.getElementById("horizonDriftRows");
        if (driftTable) {
            const records = horizon.records || [];
            if (!records.length) {
                driftTable.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:18px; color:#94a3b8;">
                    ${horizon.status === "needs_multiple_snapshots"
                        ? "Upload two or more dated spreadsheets covering the same delivery months to track tentative-to-firm forecast drift."
                        : "No overlapping delivery months across snapshots yet."}
                </td></tr>`;
            } else {
                driftTable.innerHTML = records.map(r => {
                    const driftClass = r.driftPct < -10 ? "text-danger" : r.driftPct > 10 ? "text-warning" : "text-success";
                    const finding = r.driftPct < -15
                        ? "Erosion (Tentative over-forecasted)"
                        : r.driftPct > 15
                            ? "Demand Surge (Under-forecasted)"
                            : "Stable Transition";
                    return `
                        <tr>
                            <td><strong>${escapeHTML(displayDeliveryMonth(r.deliveryMonth))}</strong></td>
                            <td>${escapeHTML(displayScheduleDate(r.earliestForecastDate))}</td>
                            <td>${formatNumber(r.earliestDemand)}</td>
                            <td><strong>${formatNumber(r.latestDemand)}</strong></td>
                            <td>${r.change > 0 ? "+" : ""}${formatNumber(r.change)}</td>
                            <td><span class="${driftClass}" style="font-weight:600;">${r.driftPct > 0 ? "+" : ""}${Number(r.driftPct).toFixed(1)}%</span></td>
                            <td><span class="badge-subtle ${driftClass}">${escapeHTML(finding)}</span></td>
                        </tr>
                    `;
                }).join("");
            }
        }

        // 7. Customer Portfolio Breakdown Table (visible when ALL customers selected)
        const portfolioPanel = document.getElementById("customerPortfolioPanel");
        const activityGrid = document.getElementById("activityKpiGrid");
        if (portfolioPanel) {
            portfolioPanel.style.display = customer === "ALL" ? "block" : "none";
        }
        if (activityGrid) {
            activityGrid.style.display = customer === "ALL" ? "grid" : "none";
        }
        currentCustomerConsistencyData = data;
        const currentTargetMonth = document.getElementById("analysisMonth")?.value || getSelectedMonthKey();
        await loadCustomerActivity(currentTargetMonth);

        // 8. Part-level consistency table (visible when specific customer selected)
        const partConsistencyPanel = document.getElementById("partConsistencyPanel");
        const partRows = document.getElementById("partConsistencyRows");
        if (partConsistencyPanel) {
            partConsistencyPanel.style.display = customer === "ALL" ? "none" : "block";
            const partSubtitle = partConsistencyPanel.querySelector(".panel-subtitle");
            if (partSubtitle) {
                partSubtitle.textContent = `Month-over-month volume variation for parts ordered by ${escapeHTML(customer)}.`;
            }
        }
        if (partRows) {
            const parts = data.parts || [];
            if (!parts.length) {
                partRows.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:18px; color:#94a3b8;">No part schedule records for ${escapeHTML(customer)}.</td></tr>`;
            } else {
                partRows.innerHTML = parts.map(p => `
                    <tr>
                        <td><strong>${escapeHTML(p.partNo)}</strong></td>
                        <td>${escapeHTML(p.productDescription || "-")}</td>
                        <td>${escapeHTML(p.application || "-")}</td>
                        <td>${p.monthsCount || 0}</td>
                        <td><strong>${formatNumber(p.totalDemand)}</strong></td>
                        <td>${formatNumber(p.meanDemand)}</td>
                        <td>${formatNumber(p.minDemand)} / ${formatNumber(p.maxDemand)}</td>
                        <td>${p.cv !== undefined ? Number(p.cv).toFixed(3) : "--"}</td>
                        <td><span class="badge-status badge-${p.status || "neutral"}">${escapeHTML(p.rating || "-")}</span></td>
                    </tr>
                `).join("");
            }
        }
    } catch (err) {
        console.error("Unable to load customer consistency analytics:", err);
    }
}

async function loadCustomerActivity(targetMonth) {
    const monthInput = document.getElementById("analysisMonth");
    const dashboardMonthInput = document.getElementById("dashboardMonth");
    const month = targetMonth
        || (monthInput && /^\d{4}-\d{2}$/.test(monthInput.value) ? monthInput.value : "")
        || (dashboardMonthInput && /^\d{4}-\d{2}$/.test(dashboardMonthInput.value) ? dashboardMonthInput.value : "")
        || getSelectedMonthKey();

    try {
        const res = await fetch(`/analytics/customer-activity?month=${encodeURIComponent(month)}`);
        if (!res.ok) throw new Error(`Customer activity request failed (HTTP ${res.status}).`);
        const data = await res.json();
        currentCustomerActivity = data;

        const summary = data.summary || {
            totalCustomers: 0,
            activeCount: 0,
            zeroMonthCount: 0,
            atRiskCount: 0,
            dormantCount: 0
        };

        const totalElem = document.getElementById("activityTotalAccounts");
        const activeElem = document.getElementById("activityActiveCount");
        const zeroElem = document.getElementById("activityZeroMonthCount");
        const dormantElem = document.getElementById("activityDormantCount");
        if (totalElem) totalElem.textContent = summary.totalCustomers;
        if (activeElem) activeElem.textContent = summary.activeCount;
        if (zeroElem) zeroElem.textContent = summary.zeroMonthCount + summary.atRiskCount;
        if (dormantElem) dormantElem.textContent = summary.dormantCount;

        const pillAll = document.getElementById("pillCountAll");
        const pillActive = document.getElementById("pillCountActive");
        const pillZero = document.getElementById("pillCountZero");
        const pillDormant = document.getElementById("pillCountDormant");
        if (pillAll) pillAll.textContent = summary.totalCustomers;
        if (pillActive) pillActive.textContent = summary.activeCount;
        if (pillZero) pillZero.textContent = summary.zeroMonthCount + summary.atRiskCount;
        if (pillDormant) pillDormant.textContent = summary.dormantCount;

        const monthHeader = document.getElementById("portfolioSelectedMonthHeader");
        if (monthHeader) {
            monthHeader.textContent = `Demand (${displayDeliveryMonth(month)})`;
        }

        const banner = document.getElementById("dashboardActivityBanner");
        const headline = document.getElementById("dashboardActivityHeadline");
        const subtext = document.getElementById("dashboardActivitySubtext");
        if (banner) {
            const zeroCount = summary.zeroMonthCount + summary.atRiskCount;
            const dormantCount = summary.dormantCount;
            if (zeroCount > 0 || dormantCount > 0) {
                banner.style.display = "flex";
                if (headline) {
                    headline.textContent = `${zeroCount} Accounts with Zero Scheduled Demand for ${displayDeliveryMonth(month)} | ${dormantCount} Inactive/Dormant`;
                }
                if (subtext) {
                    subtext.textContent = `Customer portfolio tracking highlights accounts without scheduled orders for the target month or dormant over 60–90+ days. Click to review.`;
                }
            } else {
                banner.style.display = "none";
            }
        }

        renderCustomerPortfolioTable();
    } catch (err) {
        console.error("Failed to load customer activity:", err);
    }
}

function filterCustomerActivityTable(filter) {
    currentActivityFilter = filter || "all";

    document.querySelectorAll(".activity-pill-btn").forEach(btn => {
        if (btn.getAttribute("data-filter") === currentActivityFilter) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });

    document.querySelectorAll(".activity-kpi-card").forEach(card => {
        if (card.getAttribute("data-filter") === currentActivityFilter) {
            card.classList.add("selected-kpi-card");
        } else {
            card.classList.remove("selected-kpi-card");
        }
    });

    renderCustomerPortfolioTable();
}

function renderCustomerPortfolioTable() {
    const portfolioRows = document.getElementById("customerPortfolioRows");
    if (!portfolioRows) return;

    const list = currentCustomerConsistencyData?.customerBreakdown || [];
    const activityCustomers = currentCustomerActivity?.customers || [];
    const activityMap = new Map();
    activityCustomers.forEach(act => {
        activityMap.set(act.customer, act);
    });

    const combinedCustomers = [...list];
    const existingNames = new Set(list.map(c => c.customer));
    activityCustomers.forEach(act => {
        if (!existingNames.has(act.customer)) {
            combinedCustomers.push({
                customer: act.customer,
                score: null,
                rating: "Nil Activity",
                status: "neutral",
                cv: undefined,
                meanDemand: act.meanDemand || 0,
                totalDemand: act.lifetimeTotalDemand || 0,
                biasPct: null,
                biasType: "-"
            });
        }
    });

    combinedCustomers.sort((a, b) => {
        const actA = activityMap.get(a.customer);
        const actB = activityMap.get(b.customer);
        const hasA = actA && actA.status !== "never_ordered" && ((a.totalDemand || actA.lifetimeTotalDemand || 0) > 0 || actA.targetMonthDemand > 0);
        const hasB = actB && actB.status !== "never_ordered" && ((b.totalDemand || actB.lifetimeTotalDemand || 0) > 0 || actB.targetMonthDemand > 0);
        if (hasA !== hasB) return hasA ? -1 : 1;
        const scoreA = a.score !== null && a.score !== undefined ? a.score : -1;
        const scoreB = b.score !== null && b.score !== undefined ? b.score : -1;
        if (scoreB !== scoreA) return scoreB - scoreA;
        return (b.totalDemand || 0) - (a.totalDemand || 0);
    });

    const filtered = combinedCustomers.filter(item => {
        const act = activityMap.get(item.customer) || {
            status: "never_ordered"
        };
        if (currentActivityFilter === "all") return true;
        if (currentActivityFilter === "active") return act.status === "active";
        if (currentActivityFilter === "zero_this_month") {
            return act.status === "zero_this_month" || act.status === "at_risk";
        }
        if (currentActivityFilter === "dormant") {
            return act.status === "dormant" || act.status === "never_ordered";
        }
        return true;
    });

    if (!filtered.length) {
        portfolioRows.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:24px; color:#64748b;">No customers match the "${escapeHTML(currentActivityFilter)}" filter.</td></tr>`;
        return;
    }

    portfolioRows.innerHTML = filtered.map((c, i) => {
        const act = activityMap.get(c.customer) || {
            targetMonthDemand: 0,
            lastActiveMonth: null,
            monthsInactive: null,
            status: "never_ordered",
            statusLabel: "Nil Activity"
        };

        const lifetimeDemand = c.totalDemand || act.lifetimeTotalDemand || 0;
        const hasActivity = act.status !== "never_ordered" && (lifetimeDemand > 0 || act.targetMonthDemand > 0);
        const rating = !hasActivity ? "Nil Activity" : (c.rating || "Nil Activity");
        const ratingStatus = !hasActivity ? "neutral" : (c.status || "neutral");
        const scoreDisplay = hasActivity && c.score !== null && c.score !== undefined ? `${c.score}/100` : "--";
        const cvDisplay = hasActivity && c.cv !== undefined && c.cv !== null ? Number(c.cv).toFixed(3) : "--";
        const statusLabelDisplay = !hasActivity ? "Nil Activity" : (act.statusLabel || "Nil Activity");

        const targetDemandFormatted = act.targetMonthDemand > 0
            ? `<strong style="color:#047857;">${formatNumber(act.targetMonthDemand)}</strong>`
            : `<span style="color:#94a3b8;">0</span>`;

        const lastActiveDisplay = act.lastActiveMonth
            ? escapeHTML(displayDeliveryMonth(act.lastActiveMonth))
            : `<span style="color:#94a3b8;">Never</span>`;

        return `
            <tr>
                <td><strong>#${i + 1}</strong></td>
                <td>
                    <a href="javascript:void(0)" onclick="quickSelectCustomer('${escapeHTML(c.customer)}')" style="font-weight:600; color:var(--primary);">
                        ${escapeHTML(c.customer)}
                    </a>
                </td>
                <td><span class="badge-status badge-act-${escapeHTML(act.status)}">${escapeHTML(statusLabelDisplay)}</span></td>
                <td>${targetDemandFormatted}</td>
                <td>${lastActiveDisplay}</td>
                <td><strong>${scoreDisplay}</strong></td>
                <td><span class="badge-status badge-${escapeHTML(ratingStatus)}">${escapeHTML(rating)}</span></td>
                <td>${cvDisplay}</td>
                <td>${formatNumber(lifetimeDemand)}</td>
                <td>${hasActivity && c.biasPct !== null && c.biasPct !== undefined ? `${c.biasPct > 0 ? "+" : ""}${Number(c.biasPct).toFixed(1)}%` : "N/A"}</td>
            </tr>
        `;
    }).join("");
}

function navigateToCustomerActivity(filter = "zero_this_month") {
    switchTab("analysis");
    switchAnalysisSubtab("patterns");
    activeCustomer = "ALL";
    const select = document.getElementById("customerSelect");
    if (select) select.value = "ALL";
    const analysisSelect = document.getElementById("analysisCustomerSelect");
    if (analysisSelect) analysisSelect.value = "ALL";
    filterCustomerActivityTable(filter);
    const panel = document.getElementById("customerPortfolioPanel");
    if (panel) {
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
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
    loadCustomerConsistency();
    loadCustomerActivity();
    refreshHistoricalAnalytics();
}

function onDashboardMonthChange() {
    updateDashboardMonthLabels();
    renderDashboardForCustomer(activeCustomer);
    loadCustomerActivity();
    if (document.getElementById("tab-analysis")?.classList.contains("active")) {
        refreshHistoricalAnalytics();
        loadCustomerConsistency();
    }
}

function quickSelectMonth(monthKey) {
    const input = document.getElementById("dashboardMonth");
    const analysisInput = document.getElementById("analysisMonth");
    if (input) input.value = monthKey;
    if (analysisInput) analysisInput.value = monthKey;
    onDashboardMonthChange();
    if (document.getElementById("tab-analysis")?.classList.contains("active")) {
        refreshHistoricalAnalytics();
        loadCustomerConsistency();
    }
    showToast(`Switched month view to ${monthKey}`, "info");
}

function onCustomerSelectChange() {
    const select = document.getElementById("customerSelect");
    activeCustomer = select ? select.value : "ALL";
    const analysisCustomer = document.getElementById("analysisCustomerSelect");
    if (analysisCustomer) analysisCustomer.value = activeCustomer;
    renderDashboardForCustomer(activeCustomer);
    if (document.getElementById("tab-analysis")?.classList.contains("active")) {
        loadCustomerConsistency();
        refreshHistoricalAnalytics();
    }
}

function quickSelectCustomer(custName) {
    activeCustomer = custName;
    const select = document.getElementById("customerSelect");
    if (select) select.value = custName;
    const analysisSelect = document.getElementById("analysisCustomerSelect");
    if (analysisSelect) analysisSelect.value = custName;
    renderDashboardForCustomer(custName);
    loadCustomerConsistency();
    refreshHistoricalAnalytics();
    showToast(`Switched analysis view to ${custName}`, "info");
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
    const actualDispatchTotal = filtered.reduce((s, r) =>
        s + getMonthlyDispatchQuantity(r, previousMonthKey, r.actualDispatch || 0), 0);
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
        let snapshotRows = [...filtered];
        if (currentSnapshotZeroFilter === "HIDE_ZERO") {
            snapshotRows = snapshotRows.filter(r => getMonthlyScheduleQuantity(r, month1Key, r.currentMonth || r.customerSchedule || 0) > 0);
        } else if (currentSnapshotZeroFilter === "ONLY_ZERO") {
            snapshotRows = snapshotRows.filter(r => getMonthlyScheduleQuantity(r, month1Key, r.currentMonth || r.customerSchedule || 0) === 0);
        }

        if (!snapshotRows.length) {
            tableBody.innerHTML = `<tr><td colspan="14" style="text-align: center; color: #94a3b8; padding: 20px;">No schedule records match the criteria for ${escapeHTML(label)}.</td></tr>`;
        } else {
            tableBody.innerHTML = snapshotRows.slice(0, 10).map((r, idx) => {
                const s1 = getMonthlyScheduleQuantity(r, month1Key, r.currentMonth || r.customerSchedule || 0);
                const s2 = getMonthlyScheduleQuantity(r, month2Key, r.comingMonth || 0);
                const s3 = getMonthlyScheduleQuantity(r, month3Key, 0);
                return `
                <tr>
                    <td>${escapeHTML(r.serialNo || idx + 1)}</td>
                    <td><strong>${escapeHTML(r.customerGroup || r.customer || "-")}</strong></td>
                    <td>${escapeHTML(r.customerCode || "-")}</td>
                    <td>${escapeHTML(r.customerName2 || "-")}</td>
                    <td>${escapeHTML(r.partNo || "-")}</td>
                    <td>${escapeHTML(r.helper || "-")}</td>
                    <td>${escapeHTML(r.customerPartNo || "-")}</td>
                    <td>${escapeHTML(r.line || "-")}</td>
                    <td>${escapeHTML(r.model || "-")}</td>
                    <td>${escapeHTML(r.oem || "-")}</td>
                    <td>${escapeHTML(r.productDescription || "-")}</td>
                    <td>${s1 === 0 ? `<span class="badge-zero ${currentSnapshotZeroFilter === 'ONLY_ZERO' ? 'badge-zero-highlight' : ''}" title="Zero Delivery Schedule">0</span>` : `<strong>${formatNumber(s1)}</strong>`}</td>
                    <td style="background: #fefce8; color: #854d0e;">${s2 === 0 ? `<span class="badge-zero">0</span>` : formatNumber(s2)}</td>
                    <td style="background: #fefce8; color: #854d0e;">${s3 === 0 ? `<span class="badge-zero">0</span>` : formatNumber(s3)}</td>
                </tr>
            `;
            }).join("");
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
// DASHBOARD SNAPSHOT FILTERING
// ==========================================================================

let currentSnapshotZeroFilter = "ALL";

function setDashboardSnapshotFilter(filter) {
    currentSnapshotZeroFilter = filter;
    document.querySelectorAll(".chip-filter-sm[data-snapshot-filter]").forEach(btn => {
        if (btn.getAttribute("data-snapshot-filter") === filter) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
    renderDashboardForCustomer(activeCustomer);
}

// ==========================================================================
// MASTER RECORDS TABLE (FILTER, SEARCH, ZERO FILTERING, 9-MONTH HORIZON, EXPORT)
// ==========================================================================

let currentMasterQuickFilter = "all";
let currentFilteredMasterRows = [];
let currentHorizonMode = "3M"; // "3M" (3-month rolling) or "9M" (all 9 months)
let currentDedupParts = false;

// Fast in-memory lookup maps for customer+part -> combined schedules and dispatches across all files
const customerPartMonthlyScheduleMap = new Map();
const customerPartMonthlyDispatchMap = new Map();

function getMonthKeyFromHeader(header) {
    if (!header) return null;
    const str = String(header).trim();
    if (/^\d{4}-\d{2}$/.test(str)) return str;
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 7);
    const normalized = str.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    if (/^(?:monthly plan|annual plan|plan|ifb|rev|revision|tentative|firm)\b/.test(normalized) && !/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/.test(normalized)) {
        return null;
    }
    const match = normalized.match(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec)\s*['\- ]?\s*(\d{2}|\d{4})\b/);
    if (!match) return null;

    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const monthIndex = months.indexOf(match[1].slice(0, 3));
    if (monthIndex === -1) return null;

    const yearStr = match[2];
    const year = yearStr.length === 2 ? Number(`20${yearStr}`) : Number(yearStr);
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function buildCustomerPartMonthlyMaps() {
    customerPartMonthlyScheduleMap.clear();
    customerPartMonthlyDispatchMap.clear();

    allScheduleRows.forEach(r => {
        const key = ((r.customerCode || r.customer || "").trim() + "|" + (r.partNo || "").trim()).toLowerCase();
        if (!customerPartMonthlyScheduleMap.has(key)) customerPartMonthlyScheduleMap.set(key, {});
        if (!customerPartMonthlyDispatchMap.has(key)) customerPartMonthlyDispatchMap.set(key, {});

        const schedObj = customerPartMonthlyScheduleMap.get(key);
        if (r.monthlySchedules) {
            Object.entries(r.monthlySchedules).forEach(([m, val]) => {
                if (val !== undefined && val !== null && !isNaN(val)) {
                    schedObj[m] = Number(val);
                }
            });
        }

        const dispObj = customerPartMonthlyDispatchMap.get(key);
        if (r.monthlyDispatches) {
            Object.entries(r.monthlyDispatches).forEach(([m, val]) => {
                if (val !== undefined && val !== null && !isNaN(val)) {
                    dispObj[m] = Number(val);
                }
            });
        }
    });
}

function getCombinedMonthlySchedule(row, monthKey, fallbackValue = 0) {
    if (row.monthlySchedules && row.monthlySchedules[monthKey] !== undefined) {
        return Number(row.monthlySchedules[monthKey]) || 0;
    }
    const key = ((row.customerCode || row.customer || "").trim() + "|" + (row.partNo || "").trim()).toLowerCase();
    const mapObj = customerPartMonthlyScheduleMap.get(key);
    if (mapObj && mapObj[monthKey] !== undefined) {
        return mapObj[monthKey];
    }
    return Number(fallbackValue) || 0;
}

function getCombinedMonthlyDispatch(row, monthKey, fallbackValue = 0) {
    if (row.monthlyDispatches && row.monthlyDispatches[monthKey] !== undefined) {
        return Number(row.monthlyDispatches[monthKey]) || 0;
    }
    const key = ((row.customerCode || row.customer || "").trim() + "|" + (row.partNo || "").trim()).toLowerCase();
    const mapObj = customerPartMonthlyDispatchMap.get(key);
    if (mapObj && mapObj[monthKey] !== undefined) {
        return mapObj[monthKey];
    }
    return Number(fallbackValue) || 0;
}

function getAllAvailableMonthKeys() {
    const monthsSet = new Set();
    allScheduleRows.forEach(r => {
        if (r.monthlySchedules) {
            Object.keys(r.monthlySchedules).forEach(m => {
                if (/^\d{4}-\d{2}$/.test(m)) monthsSet.add(m);
            });
        }
        if (r.monthlyDispatches) {
            Object.keys(r.monthlyDispatches).forEach(m => {
                if (/^\d{4}-\d{2}$/.test(m)) monthsSet.add(m);
            });
        }
        const parsedKey = getMonthKeyFromHeader(r.deliveryMonth);
        if (parsedKey) monthsSet.add(parsedKey);
    });
    // Ensure all 9 known months are represented in chronological order
    const defaultMonths = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];
    defaultMonths.forEach(m => monthsSet.add(m));
    return Array.from(monthsSet).sort();
}

function setHorizonMode(mode) {
    currentHorizonMode = mode;
    const btn3M = document.getElementById("btnHorizon3M");
    const btn9M = document.getElementById("btnHorizon9M");
    const dedupWrap = document.getElementById("dedupPartsToggleWrap");

    if (btn3M) btn3M.classList.toggle("active", mode === "3M");
    if (btn9M) btn9M.classList.toggle("active", mode === "9M");

    if (dedupWrap) {
        dedupWrap.style.display = mode === "9M" ? "inline-flex" : "none";
    }

    const recBanner = document.getElementById("recordsPlanBanner");
    if (recBanner) {
        if (mode === "9M") {
            recBanner.textContent = "Full Horizon View: April 2026 to December 2026 (All 9 Monthly Schedules)";
        } else {
            const selectedMonth = getSelectedMonthKey();
            recBanner.textContent = `Monthly Plan: ${formatMonthLabel(selectedMonth)} (FIRM) and (TENTATIVE 2 months)`;
        }
    }

    renderMasterRecordsTable();
    showToast(mode === "9M" ? "Switched to Full 9-Month Horizon view (Apr–Dec 2026)" : "Switched to 3-Month Plan view", "info");
}

function onDedupPartsChange() {
    const chk = document.getElementById("chkDedupParts");
    currentDedupParts = chk ? chk.checked : false;
    renderMasterRecordsTable();
}

function onRecordsDeliveryMonthChange() {
    const monthSelect = document.getElementById("recordsMonthFilter");
    const selectedMonth = monthSelect ? monthSelect.value : "ALL";
    if (selectedMonth && selectedMonth !== "ALL") {
        const dashMonth = document.getElementById("dashboardMonth");
        if (dashMonth) dashMonth.value = selectedMonth;
        updateDashboardMonthLabels();
    }
    renderMasterRecordsTable();
}

function setQuickZeroFilter(mode) {
    currentMasterQuickFilter = mode;
    const schedSelect = document.getElementById("recordsScheduleFilter");
    const dispSelect = document.getElementById("recordsDispatchFilter");

    if (mode === "all") {
        if (schedSelect) schedSelect.value = "ALL";
        if (dispSelect) dispSelect.value = "ALL";
    } else if (mode === "hide_zero_schedules") {
        if (schedSelect) schedSelect.value = "HIDE_ZERO";
        if (dispSelect) dispSelect.value = "ALL";
    } else if (mode === "hide_zero_dispatches") {
        if (schedSelect) schedSelect.value = "ALL";
        if (dispSelect) dispSelect.value = "HIDE_ZERO";
    } else if (mode === "hide_both_zero") {
        if (schedSelect) schedSelect.value = "ALL";
        if (dispSelect) dispSelect.value = "ALL";
    } else if (mode === "only_zero_schedules") {
        if (schedSelect) schedSelect.value = "ONLY_ZERO";
        if (dispSelect) dispSelect.value = "ALL";
    } else if (mode === "only_zero_dispatches") {
        if (schedSelect) schedSelect.value = "ALL";
        if (dispSelect) dispSelect.value = "ONLY_ZERO";
    } else if (mode === "both_zero") {
        if (schedSelect) schedSelect.value = "ONLY_ZERO";
        if (dispSelect) dispSelect.value = "ONLY_ZERO";
    } else if (mode === "scheduled_not_dispatched") {
        if (schedSelect) schedSelect.value = "HIDE_ZERO";
        if (dispSelect) dispSelect.value = "ONLY_ZERO";
    }

    updateQuickFilterPillUI(mode);
    renderMasterRecordsTable();
}

function onDropdownFilterChange() {
    const schedVal = document.getElementById("recordsScheduleFilter")?.value || "ALL";
    const dispVal = document.getElementById("recordsDispatchFilter")?.value || "ALL";

    if (schedVal === "ALL" && dispVal === "ALL") {
        currentMasterQuickFilter = "all";
    } else if (schedVal === "HIDE_ZERO" && dispVal === "ALL") {
        currentMasterQuickFilter = "hide_zero_schedules";
    } else if (schedVal === "ALL" && dispVal === "HIDE_ZERO") {
        currentMasterQuickFilter = "hide_zero_dispatches";
    } else if (schedVal === "ONLY_ZERO" && dispVal === "ALL") {
        currentMasterQuickFilter = "only_zero_schedules";
    } else if (schedVal === "ALL" && dispVal === "ONLY_ZERO") {
        currentMasterQuickFilter = "only_zero_dispatches";
    } else if (schedVal === "ONLY_ZERO" && dispVal === "ONLY_ZERO") {
        currentMasterQuickFilter = "both_zero";
    } else if (schedVal === "HIDE_ZERO" && dispVal === "ONLY_ZERO") {
        currentMasterQuickFilter = "scheduled_not_dispatched";
    } else {
        currentMasterQuickFilter = "custom";
    }

    updateQuickFilterPillUI(currentMasterQuickFilter);
    renderMasterRecordsTable();
}

function updateQuickFilterPillUI(mode) {
    document.querySelectorAll(".filter-pill[data-filter-mode]").forEach(pill => {
        if (pill.getAttribute("data-filter-mode") === mode) {
            pill.classList.add("active");
        } else {
            pill.classList.remove("active");
        }
    });
}

function resetAllMasterFilters() {
    const searchInput = document.getElementById("tableSearchInput");
    const custSelect = document.getElementById("recordsCustomerFilter");
    const versionSelect = document.getElementById("recordsVersionFilter");
    const monthSelect = document.getElementById("recordsMonthFilter");
    const schedSelect = document.getElementById("recordsScheduleFilter");
    const dispSelect = document.getElementById("recordsDispatchFilter");
    const chkDedup = document.getElementById("chkDedupParts");

    if (searchInput) searchInput.value = "";
    if (custSelect) custSelect.value = "ALL";
    if (versionSelect) versionSelect.value = "ALL";
    if (monthSelect) monthSelect.value = "ALL";
    if (schedSelect) schedSelect.value = "ALL";
    if (dispSelect) dispSelect.value = "ALL";
    if (chkDedup) chkDedup.checked = false;
    currentDedupParts = false;

    currentMasterQuickFilter = "all";
    updateQuickFilterPillUI("all");
    renderMasterRecordsTable();
    showToast("Master table filters reset", "info");
}

function navigateToZeroSchedules() {
    switchTab("records");
    setQuickZeroFilter("only_zero_schedules");
}

function navigateToZeroDispatches() {
    switchTab("records");
    setQuickZeroFilter("only_zero_dispatches");
}

function filterMasterTable() {
    renderMasterRecordsTable();
}

function renderMasterRecordsTable() {
    const thead = document.getElementById("masterRecordsHead");
    const tbody = document.getElementById("masterRecordsBody");
    const countEl = document.getElementById("recordCounterText");
    const searchInput = document.getElementById("tableSearchInput");
    const filterSelect = document.getElementById("recordsCustomerFilter");
    const versionSelect = document.getElementById("recordsVersionFilter");
    const monthSelect = document.getElementById("recordsMonthFilter");
    const schedSelect = document.getElementById("recordsScheduleFilter");
    const dispSelect = document.getElementById("recordsDispatchFilter");

    if (!tbody) return;

    if (!customerPartMonthlyScheduleMap.size) {
        buildCustomerPartMonthlyMaps();
    }

    const allAvailableMonths = getAllAvailableMonthKeys();

    // Populate Delivery Months Dropdown dynamically with all 9 months (Apr-26 to Dec-26)
    if (monthSelect) {
        const currentSelectedMonth = monthSelect.value || "ALL";
        let optionsHtml = `<option value="ALL">All Delivery Months (Apr–Dec 2026)</option>`;
        allAvailableMonths.forEach(m => {
            optionsHtml += `<option value="${m}">${formatMonthLabel(m)} (${formatLongMonthLabel(m)})</option>`;
        });
        monthSelect.innerHTML = optionsHtml;
        monthSelect.value = (allAvailableMonths.includes(currentSelectedMonth) || currentSelectedMonth === "ALL")
            ? currentSelectedMonth
            : "ALL";
    }

    const setFilterOptions = (select, label, values) => {
        if (!select) return "ALL";
        const selectedValue = select.value || "ALL";
        const options = [...new Set(values.filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b));
        select.innerHTML = `<option value="ALL">${label}</option>` +
            options.map(value => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join("");
        select.value = options.includes(selectedValue) ? selectedValue : "ALL";
        return select.value;
    };

    let rows = [...allScheduleRows];
    const searchTerm = (searchInput?.value || "").toLowerCase().trim();
    const custFilter = filterSelect?.value || "ALL";
    const versionFilter = setFilterOptions(versionSelect, "All versions", rows.map(row => row.version));
    const monthFilter = monthSelect?.value || "ALL";

    if (custFilter !== "ALL") {
        rows = rows.filter(r => r.customer === custFilter);
    }
    if (versionFilter !== "ALL") {
        rows = rows.filter(r => (r.version || "Current") === versionFilter);
    }

    // Filter by expanded delivery month if a specific month is selected
    if (monthFilter !== "ALL") {
        rows = rows.filter(r => {
            const s = getCombinedMonthlySchedule(r, monthFilter);
            const d = getCombinedMonthlyDispatch(r, monthFilter);
            const dmKey = getMonthKeyFromHeader(r.deliveryMonth);
            return s > 0 || d > 0 || dmKey === monthFilter;
        });
    }

    if (searchTerm) {
        rows = rows.filter(r => [
            r.serialNo, r.customer, r.customerGroup, r.customerCode, r.customerName2,
            r.partNo, r.helper, r.customerPartNo, r.line, r.model, r.oem,
            r.productDescription, r.application, r.version, r.deliveryMonth, r.source, r.importedAt
        ].some(value => String(value || "").toLowerCase().includes(searchTerm)));
    }

    // Deduplicate by Customer + Part if option is enabled in 9M Horizon mode
    if (currentHorizonMode === "9M" && currentDedupParts) {
        const seenKeys = new Set();
        const dedupedRows = [];
        rows.forEach(r => {
            const key = ((r.customerCode || r.customer || "").trim() + "|" + (r.partNo || "").trim()).toLowerCase();
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                dedupedRows.push(r);
            }
        });
        rows = dedupedRows;
    }

    const month1Key = (monthFilter !== "ALL" && /^\d{4}-\d{2}$/.test(monthFilter))
        ? monthFilter
        : getSelectedMonthKey();
    const month2Key = shiftYearMonth(month1Key, 1);
    const month3Key = shiftYearMonth(month1Key, 2);

    // Compute dynamic counts for the quick filter pills
    const baseTotal = rows.length;
    let countActiveSched = 0;
    let countActiveDisp = 0;
    let countActiveAny = 0;
    let countZeroSched = 0;
    let countZeroDisp = 0;
    let countBothZero = 0;
    let countSchedNoDisp = 0;

    rows.forEach(r => {
        let s;
        if (currentHorizonMode === "9M") {
            s = allAvailableMonths.reduce((sum, m) => sum + getCombinedMonthlySchedule(r, m), 0);
        } else {
            s = getCombinedMonthlySchedule(r, month1Key, r.currentMonth || r.customerSchedule || 0);
        }
        const d = getCombinedMonthlyDispatch(r, month1Key, r.actualDispatch || 0);

        if (s > 0) countActiveSched++;
        if (d > 0) countActiveDisp++;
        if (s > 0 || d > 0) countActiveAny++;
        if (s === 0) countZeroSched++;
        if (d === 0) countZeroDisp++;
        if (s === 0 && d === 0) countBothZero++;
        if (s > 0 && d === 0) countSchedNoDisp++;
    });

    const badgeAll = document.getElementById("badgeCountAll");
    const badgeActS = document.getElementById("badgeCountActiveSched");
    const badgeActD = document.getElementById("badgeCountActiveDisp");
    const badgeActAny = document.getElementById("badgeCountActiveAny");
    const badgeZeroS = document.getElementById("badgeCountZeroSched");
    const badgeZeroD = document.getElementById("badgeCountZeroDisp");
    const badgeBothZ = document.getElementById("badgeCountBothZero");
    const badgeSNoD = document.getElementById("badgeCountSchedNoDisp");

    if (badgeAll) badgeAll.textContent = baseTotal;
    if (badgeActS) badgeActS.textContent = countActiveSched;
    if (badgeActD) badgeActD.textContent = countActiveDisp;
    if (badgeActAny) badgeActAny.textContent = countActiveAny;
    if (badgeZeroS) badgeZeroS.textContent = countZeroSched;
    if (badgeZeroD) badgeZeroD.textContent = countZeroDisp;
    if (badgeBothZ) badgeBothZ.textContent = countBothZero;
    if (badgeSNoD) badgeSNoD.textContent = countSchedNoDisp;

    // Apply delivery schedule and dispatch zero filtering
    const schedFilter = schedSelect?.value || "ALL";
    const dispFilter = dispSelect?.value || "ALL";

    if (currentMasterQuickFilter === "hide_both_zero") {
        rows = rows.filter(r => {
            let s;
            if (currentHorizonMode === "9M") {
                s = allAvailableMonths.reduce((sum, m) => sum + getCombinedMonthlySchedule(r, m), 0);
            } else {
                s = getCombinedMonthlySchedule(r, month1Key, r.currentMonth || r.customerSchedule || 0);
            }
            const d = getCombinedMonthlyDispatch(r, month1Key, r.actualDispatch || 0);
            return s > 0 || d > 0;
        });
    } else {
        if (schedFilter === "HIDE_ZERO") {
            rows = rows.filter(r => {
                if (currentHorizonMode === "9M") {
                    return allAvailableMonths.reduce((sum, m) => sum + getCombinedMonthlySchedule(r, m), 0) > 0;
                }
                return getCombinedMonthlySchedule(r, month1Key, r.currentMonth || r.customerSchedule || 0) > 0;
            });
        } else if (schedFilter === "ONLY_ZERO") {
            rows = rows.filter(r => {
                if (currentHorizonMode === "9M") {
                    return allAvailableMonths.reduce((sum, m) => sum + getCombinedMonthlySchedule(r, m), 0) === 0;
                }
                return getCombinedMonthlySchedule(r, month1Key, r.currentMonth || r.customerSchedule || 0) === 0;
            });
        }

        if (dispFilter === "HIDE_ZERO") {
            rows = rows.filter(r => getCombinedMonthlyDispatch(r, month1Key, r.actualDispatch || 0) > 0);
        } else if (dispFilter === "ONLY_ZERO") {
            rows = rows.filter(r => getCombinedMonthlyDispatch(r, month1Key, r.actualDispatch || 0) === 0);
        }
    }

    currentFilteredMasterRows = rows;

    let filterNotes = [];
    if (currentHorizonMode === "9M") filterNotes.push("All 9 Months View");
    if (currentDedupParts && currentHorizonMode === "9M") filterNotes.push("Deduplicated (182 Parts)");
    if (monthFilter !== "ALL") filterNotes.push(`Month: ${formatMonthLabel(monthFilter)}`);
    if (currentMasterQuickFilter === "hide_both_zero") {
        filterNotes.push("Hiding both zero");
    } else {
        if (schedFilter === "HIDE_ZERO") filterNotes.push("Hiding zero schedules");
        if (schedFilter === "ONLY_ZERO") filterNotes.push("Zero schedules only");
        if (dispFilter === "HIDE_ZERO") filterNotes.push("Hiding zero dispatches");
        if (dispFilter === "ONLY_ZERO") filterNotes.push("Zero dispatches only");
    }

    const filterNoteStr = filterNotes.length ? ` (${filterNotes.join(" | ")})` : "";
    if (countEl) countEl.textContent = `Showing ${rows.length} of ${allScheduleRows.length} records${filterNoteStr}`;

    // Render Table Header dynamically for 3M vs 9M mode
    if (thead) {
        if (currentHorizonMode === "9M") {
            thead.innerHTML = `
                <tr class="super-header-row">
                    <th colspan="11" class="th-info-group">Part &amp; Customer Information</th>
                    <th colspan="${allAvailableMonths.length}" class="th-9m-header">Customer Demand Horizon (April 2026 – December 2026)</th>
                    <th class="th-total-header">TOTAL</th>
                    <th colspan="5" class="th-ops-header">Performance &amp; Status</th>
                </tr>
                <tr>
                    <th>Sl No</th>
                    <th>Customer</th>
                    <th>Customer code</th>
                    <th>Customer name2</th>
                    <th>PART No.</th>
                    <th>Helper</th>
                    <th>Customer Part No</th>
                    <th>Line</th>
                    <th>Model</th>
                    <th>OEM's</th>
                    <th>Description</th>
                    ${allAvailableMonths.map(m => `
                        <th class="th-month-col ${m === month1Key ? 'th-active-focus' : ''}">${formatMonthLabel(m)}</th>
                    `).join("")}
                    <th class="th-total-header">Total (9M)</th>
                    <th>Version</th>
                    <th>Schedule Received</th>
                    <th>Actual Dispatch</th>
                    <th>Backlog</th>
                    <th>Actions</th>
                </tr>
            `;
        } else {
            thead.innerHTML = `
                <tr class="super-header-row">
                    <th colspan="11" class="th-info-group">Part &amp; Customer Information</th>
                    <th id="recordsFirmSuperHeader" class="th-firm-header">FIRM</th>
                    <th colspan="2" class="th-tentative-super-header">TENTATIVE QTY</th>
                    <th colspan="5" class="th-ops-header">Performance &amp; Status</th>
                </tr>
                <tr>
                    <th>Sl No</th>
                    <th>Customer</th>
                    <th>Customer code</th>
                    <th>Customer name2</th>
                    <th>PART No.</th>
                    <th>Helper</th>
                    <th>Customer Part No</th>
                    <th>Line</th>
                    <th>Model</th>
                    <th>OEM's</th>
                    <th>Description</th>
                    <th id="recordsMonth1Label">${formatMonthLabel(month1Key)}</th>
                    <th id="recordsMonth2Label" class="th-tentative">${formatMonthLabel(month2Key)}</th>
                    <th id="recordsMonth3Label" class="th-tentative">${formatMonthLabel(month3Key)}</th>
                    <th>Version</th>
                    <th>Schedule Received</th>
                    <th>Actual Dispatch</th>
                    <th>Backlog</th>
                    <th>Actions</th>
                </tr>
            `;
        }
    }

    if (!rows.length) {
        const totalColspan = currentHorizonMode === "9M" ? 11 + allAvailableMonths.length + 1 + 5 : 19;
        tbody.innerHTML = `<tr><td colspan="${totalColspan}" style="text-align: center; padding: 28px; color: #94a3b8; font-size: 14px;">
            No schedule records match the selected criteria.
            <button type="button" class="btn-clear-filters" onclick="resetAllMasterFilters()" style="margin-left: 10px; padding: 4px 10px;">↺ Clear Filters</button>
        </td></tr>`;
        return;
    }

    const isSingleZeroSched = schedFilter === "ONLY_ZERO";
    const isSingleZeroDisp = dispFilter === "ONLY_ZERO";

    tbody.innerHTML = rows.map((r, displayIndex) => {
        const originalIndex = allScheduleRows.indexOf(r);

        const monthDemand = getCombinedMonthlySchedule(r, month1Key, r.currentMonth || r.customerSchedule || 0);
        const monthDispatch = getCombinedMonthlyDispatch(r, month1Key, r.actualDispatch || 0);
        const monthCommitment = (r.monthlyCommitments && r.monthlyCommitments[month1Key] !== undefined)
            ? Number(r.monthlyCommitments[month1Key])
            : (r.companyCommitment ?? monthDemand);
        const hasSpecificMonth = (r.monthlyCommitments && r.monthlyCommitments[month1Key] !== undefined) || (r.monthlyDispatches && r.monthlyDispatches[month1Key] !== undefined);
        const monthBalance = hasSpecificMonth
            ? (monthCommitment - monthDispatch)
            : (r.balance ?? "-");

        const isZeroSched = monthDemand === 0;
        const isZeroDisp = monthDispatch === 0;
        const isPending = monthDemand > 0 && monthDispatch === 0;

        let scheduleColumnsHtml = "";

        if (currentHorizonMode === "9M") {
            let total9M = 0;
            const monthCells = allAvailableMonths.map(m => {
                const qty = getCombinedMonthlySchedule(r, m);
                total9M += qty;
                const isFocus = m === month1Key;
                return `
                    <td class="cell-month-val ${isFocus ? 'cell-active-focus' : ''}">
                        ${qty === 0 ? `<span class="badge-zero">0</span>` : `<strong>${formatNumber(qty)}</strong>`}
                    </td>
                `;
            }).join("");

            scheduleColumnsHtml = `
                ${monthCells}
                <td class="cell-total-9m">${formatNumber(total9M)}</td>
            `;
        } else {
            const m2 = getCombinedMonthlySchedule(r, month2Key, r.comingMonth || 0);
            const m3 = getCombinedMonthlySchedule(r, month3Key, 0);

            scheduleColumnsHtml = `
                <td>${isZeroSched 
                    ? `<span class="badge-zero ${isSingleZeroSched ? 'badge-zero-highlight' : ''}" title="Zero Delivery Schedule">0</span>` 
                    : `<strong>${formatNumber(monthDemand)}</strong>`}</td>
                <td style="background: #fefce8; color: #854d0e;">${m2 === 0 ? `<span class="badge-zero">0</span>` : formatNumber(m2)}</td>
                <td style="background: #fefce8; color: #854d0e;">${m3 === 0 ? `<span class="badge-zero">0</span>` : formatNumber(m3)}</td>
            `;
        }

        return `
            <tr class="${isZeroSched && isZeroDisp ? 'tr-both-zero' : ''}">
                <td>${escapeHTML(r.serialNo || displayIndex + 1)}</td>
                <td><strong>${escapeHTML(r.customerGroup || r.customer || "-")}</strong></td>
                <td>${escapeHTML(r.customerCode || "-")}</td>
                <td>${escapeHTML(r.customerName2 || "-")}</td>
                <td>${escapeHTML(r.partNo || "-")}</td>
                <td>${escapeHTML(r.helper || "-")}</td>
                <td>${escapeHTML(r.customerPartNo || "-")}</td>
                <td>${escapeHTML(r.line || "-")}</td>
                <td>${escapeHTML(r.model || "-")}</td>
                <td>${escapeHTML(r.oem || "-")}</td>
                <td>${escapeHTML(r.productDescription || "-")}</td>
                ${scheduleColumnsHtml}
                <td>${escapeHTML(r.version || "Current")}</td>
                <td>${escapeHTML(displayScheduleReceived(r))}</td>
                <td>${isZeroDisp
                    ? `<span class="badge-zero ${isSingleZeroDisp ? 'badge-zero-dispatch-highlight' : ''}" title="Zero Actual Dispatch">0</span>${isPending ? `<span class="badge-status-pending" title="Scheduled demand is ${formatNumber(monthDemand)}, but actual dispatch is 0">Pending</span>` : ''}`
                    : `<span class="badge-dispatched">${formatNumber(monthDispatch)}</span>`}</td>
                <td><strong>${typeof monthBalance === "number" ? formatNumber(monthBalance) : monthBalance}</strong></td>
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
        const response = await fetch(`/api/schedule-row/${index}`, { method: "DELETE" });
        if (!response.ok) throw new Error("Delete request failed.");
        allScheduleRows.splice(index, 1);
        buildCustomerPartMonthlyMaps();
    } catch (error) {
        showToast("Unable to delete the schedule row from the backend.", "error");
        return;
    }

    renderDashboardForCustomer(activeCustomer);
    renderMasterRecordsTable();
    showToast("Schedule row deleted", "info");
}

function exportRecordsToCSV() {
    const rowsToExport = currentFilteredMasterRows && currentFilteredMasterRows.length ? currentFilteredMasterRows : allScheduleRows;

    if (!rowsToExport.length) {
        showToast("No records available to export", "error");
        return;
    }

    const allAvailableMonths = getAllAvailableMonthKeys();
    const month1Key = getSelectedMonthKey();
    const month2Key = shiftYearMonth(month1Key, 1);
    const month3Key = shiftYearMonth(month1Key, 2);

    let headers;
    let buildRowValues;

    if (currentHorizonMode === "9M") {
        headers = [
            "Sl No", "Customer", "Customer code", "Customer name2", "PART No.", "Helper",
            "Customer Part No", "Line", "Model", "OEM's", "Description",
            ...allAvailableMonths.map(m => formatMonthLabel(m)),
            "Total 9M Demand",
            "Version", "Schedule Received Date", "Actual Dispatch Qty", "Backlog", "Saved At", "Source"
        ];

        buildRowValues = (r, idx) => {
            const monthlyVals = allAvailableMonths.map(m => getCombinedMonthlySchedule(r, m));
            const total9M = monthlyVals.reduce((sum, v) => sum + v, 0);
            return [
                `"${r.serialNo || idx + 1}"`,
                `"${r.customerGroup || r.customer || ''}"`,
                `"${r.customerCode || ''}"`,
                `"${r.customerName2 || ''}"`,
                `"${r.partNo || ''}"`,
                `"${r.helper || ''}"`,
                `"${r.customerPartNo || ''}"`,
                `"${r.line || ''}"`,
                `"${r.model || ''}"`,
                `"${r.oem || ''}"`,
                `"${r.productDescription || ''}"`,
                ...monthlyVals,
                total9M,
                `"${r.version || 'Current'}"`,
                `"${r.scheduleReceivedDate || ''}"`,
                getCombinedMonthlyDispatch(r, month1Key, r.actualDispatch || 0),
                r.balance === null || r.balance === undefined ? "" : formatNumber(r.balance),
                `"${r.importedAt || ''}"`,
                `"${r.source || ''}"`
            ];
        };
    } else {
        headers = [
            "Sl No", "Customer", "Customer code", "Customer name2", "PART No.", "Helper",
            "Customer Part No", "Line", "Model", "OEM's", "Description",
            formatMonthLabel(month1Key), formatMonthLabel(month2Key), formatMonthLabel(month3Key),
            "Version", "Schedule Received Date", "Actual Dispatch Qty", "Backlog", "Saved At", "Source"
        ];

        buildRowValues = (r, idx) => [
            `"${r.serialNo || idx + 1}"`,
            `"${r.customerGroup || r.customer || ''}"`,
            `"${r.customerCode || ''}"`,
            `"${r.customerName2 || ''}"`,
            `"${r.partNo || ''}"`,
            `"${r.helper || ''}"`,
            `"${r.customerPartNo || ''}"`,
            `"${r.line || ''}"`,
            `"${r.model || ''}"`,
            `"${r.oem || ''}"`,
            `"${r.productDescription || ''}"`,
            getCombinedMonthlySchedule(r, month1Key, r.currentMonth || r.customerSchedule || 0),
            getCombinedMonthlySchedule(r, month2Key, r.comingMonth || 0),
            getCombinedMonthlySchedule(r, month3Key, 0),
            `"${r.version || 'Current'}"`,
            `"${r.scheduleReceivedDate || ''}"`,
            getCombinedMonthlyDispatch(r, month1Key, r.actualDispatch || 0),
            r.balance === null || r.balance === undefined ? "" : formatNumber(r.balance),
            `"${r.importedAt || ''}"`,
            `"${r.source || ''}"`
        ];
    }

    const csvRows = [headers.join(",")];
    rowsToExport.forEach((r, idx) => {
        csvRows.push(buildRowValues(r, idx).join(","));
    });

    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    const horizonSuffix = currentHorizonMode === "9M" ? "9Months" : "3Months";
    link.download = `IFB_Schedule_Export_${horizonSuffix}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    showToast(`Exported ${rowsToExport.length} schedule records (${currentHorizonMode} mode) to CSV`, "success");
}

async function loadImportedFilesList() {
    const tbody = document.getElementById("importedFilesTableBody");
    if (!tbody) return;

    try {
        const res = await fetch("/api/imported-files");
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
    window.location.href = `/api/download-file/${encodeURIComponent(snapshotId)}`;
}

async function deleteImportedFile(snapshotId, filename) {
    if (!confirm(`Are you sure you want to delete the imported schedule workbook "${filename}"?\nThis will remove its records from the portal.`)) {
        return;
    }

    try {
        const res = await fetch(`/api/imported-file/${encodeURIComponent(snapshotId)}`, {
            method: "DELETE"
        });
        if (!res.ok) throw new Error("Failed to delete snapshot.");
        showToast("Workbook & snapshot deleted successfully", "success");

        await loadDashboardData();
        await loadMasterData();
        loadImportedFilesList();
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

function extractDateFromFilename(name) {
    if (!name) return "";
    const str = String(name);
    const dmy = str.match(/(?:^|[^\d])(\d{1,2})[._/-](\d{1,2})[._/-](\d{4})(?:[^\d]|$)/);
    if (dmy) {
        let day = Number(dmy[1]);
        let month = Number(dmy[2]);
        const year = Number(dmy[3]);
        if (day > 12 && month <= 12) {} else if (month > 12 && day <= 12) { [day, month] = [month, day]; }
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        }
    }
    const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const named = str.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s._-]*(\d{2,4})/i);
    if (named) {
        const mi = monthNames.indexOf(named[1].slice(0, 3).toLowerCase());
        if (mi !== -1) {
            const y = named[2].length === 2 ? `20${named[2]}` : named[2];
            return `${y}-${String(mi + 1).padStart(2, "0")}-01`;
        }
    }
    return "";
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    const badge = document.getElementById("selectedFileName");
    if (file && badge) {
        badge.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        badge.style.display = "inline-block";
        const detected = extractDateFromFilename(file.name);
        const dateInput = document.getElementById("snapshotDate");
        if (detected && dateInput) {
            dateInput.value = detected;
        }
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
        const response = await fetch("/upload-excel", { method: "POST", body: formData });
        const responseText = await response.text();
        let result;
        try {
            result = JSON.parse(responseText);
        } catch {
            if (response.status === 405) {
                throw new Error("This server does not accept spreadsheet uploads. Start the app with `npm start` and open it from http://localhost:3000 so the request reaches the backend.");
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
            buildCustomerPartMonthlyMaps();
            await loadMasterData();
            activeCustomer = "ALL";
            renderDashboardForCustomer(activeCustomer);
            renderMasterRecordsTable();
            loadImportedFilesList();

            if (status) {
                status.style.color = "#059669";
                const sheetInfo = result.sheetName ? ` [Sheet: ${result.sheetName}]` : "";
                const horizonInfo = result.detectedMonths && result.detectedMonths.length ? ` (Horizons: ${result.detectedMonths.join(", ")})` : "";
                const dispatchInfo = result.hasDispatches ? " Dispatches recorded." : "";
                status.textContent = `${result.message} ${result.importedCount || allScheduleRows.length} rows imported${sheetInfo}.${horizonInfo}${dispatchInfo}`;
            }

            showToast(`Spreadsheet uploaded successfully (${result.importedCount || allScheduleRows.length} rows).`, "success");
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

async function initApplication() {
    startClock();
    initializeSnapshotDate();
    initDragAndDrop();
    updateDashboardMonthLabels();
    try {
        const response = await fetch("/dashboard");
        if (!response.ok) {
            throw new Error("Dashboard request failed.");
        }
        const data = await response.json();
        allScheduleRows = Array.isArray(data.rows) ? data.rows : [];
        buildCustomerPartMonthlyMaps();
    } catch (error) {
        allScheduleRows = [];
        showToast("Unable to fetch schedule data. Start the backend and try again.", "error");
    }

    await loadMasterData();
    activeCustomer = "ALL";
    renderDashboardForCustomer(activeCustomer);
    renderMasterRecordsTable();
    loadImportedFilesList();
    await loadCustomerActivity();
    switchTab("dashboard");
}

document.addEventListener("DOMContentLoaded", initApplication);
