const express = require("express");
const cors = require("cors");
const multer = require("multer");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const oracledb = require("oracledb");
const dbConfig = require("./dbconfig");
const {
    calculateScheduleAnalytics,
    getDemandSnapshotTimeline,
    compareDifferentSheets,
    compareWithinSameSheet,
    getSnapshotComparisonMeta
} = require("./schedule-analytics");
const { getScheduleRecords } = require("./excel-header");

const app = express();
const PORT = Number(process.env.PORT || 3001);
const uploadDir = path.join(__dirname, "../upload");
const scheduleDataPath = path.join(__dirname, "../database/schedule-records.json");
const scheduleSnapshotsPath = path.join(__dirname, "../database/schedule-snapshots.json");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

let latestScheduleData = [];
let scheduleSnapshots = [];
let pool;

async function initializeDatabase() {
    if (!dbConfig.enabled) {
        console.log("Oracle connection disabled. Set DB_ENABLED=true to enable it.");
        return;
    }

    if (!dbConfig.user || !dbConfig.password) {
        console.warn("Oracle credentials are missing. Set DB_USER and DB_PASSWORD before starting the server.");
        return;
    }

    try {
        const oracleClientDir = process.env.ORACLE_CLIENT_LIB_DIR
            || "C:\\oraclexe\\app\\oracle\\product\\11.2.0\\server\\bin";
        if (!oracledb.oracleClientVersionString) {
            oracledb.initOracleClient({ libDir: oracleClientDir });
        }

        pool = await oracledb.createPool({
            ...dbConfig,
            poolAlias: "default",
            enableStatistics: true
        });
        const connection = await pool.getConnection();
        await connection.close();
        console.log("Oracle DB pool initialized successfully.");
    } catch (error) {
        console.error("Oracle connection failed:", error.message);
        if (pool) {
            await pool.close(0);
            pool = undefined;
        }
    }
}

function normalizeHeader(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function toNumber(value) {
    if (value === null || value === undefined || value === "") return 0;

    if (typeof value === "number") return Number.isFinite(value) ? value : 0;

    const cleaned = String(value).replace(/[^0-9.-]/g, "");
    if (!cleaned) return 0;

    const num = Number(cleaned);
    return Number.isFinite(num) ? num : 0;
}

function hasCellValue(value) {
    return value !== null && value !== undefined && String(value).trim() !== "";
}

function isValidDateOnly(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

function getHeaderIndex(headers, aliases) {
    const normalizedHeaders = headers.map((header) => normalizeHeader(header));

    for (const alias of aliases) {
        const aliasKey = normalizeHeader(alias);
        const index = normalizedHeaders.findIndex((header) => header === aliasKey);
        if (index !== -1) return index;
    }

    for (const alias of aliases) {
        const aliasKey = normalizeHeader(alias);
        const index = normalizedHeaders.findIndex((header) => header.includes(aliasKey));
        if (index !== -1) return index;
    }

    return -1;
}

function getMonthKeyFromHeader(header) {
    const match = normalizeHeader(header).match(/^([a-z]+)\s+(\d{2}|\d{4})$/);
    if (!match) return null;

    const monthIndex = [
        "jan", "feb", "mar", "apr", "may", "jun",
        "jul", "aug", "sep", "oct", "nov", "dec"
    ].findIndex((month) => month === match[1].slice(0, 3));
    if (monthIndex === -1) return null;

    const year = match[2].length === 2 ? Number(`20${match[2]}`) : Number(match[2]);
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function getMonthMetricFromHeader(header) {
    const normalized = normalizeHeader(header);
    const match = normalized.match(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec)\s+(\d{2}|\d{4})\b/);
    if (!match) return null;

    const monthIndex = [
        "jan", "feb", "mar", "apr", "may", "jun",
        "jul", "aug", "sep", "oct", "nov", "dec"
    ].indexOf(match[1].slice(0, 3));
    const year = match[2].length === 2 ? Number(`20${match[2]}`) : Number(match[2]);
    const monthKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    const prefix = normalized.slice(0, match.index).trim();
    const suffix = normalized.slice(match.index + match[0].length).trim();
    const metricLabel = `${prefix} ${suffix}`.trim();

    if (/^(?:company )?commitment(?: qty| quantity)?$/.test(metricLabel)) {
        return { monthKey, metric: "commitment" };
    }
    if (/^(?:(?:actual )?dispatch)(?: qty| quantity)?$/.test(metricLabel)) {
        return { monthKey, metric: "dispatch" };
    }
    if (/^(?:(?:actual )?dispatch) date$/.test(metricLabel)) {
        return { monthKey, metric: "dispatchDate" };
    }
    return null;
}

function mapScheduleRow(record) {
    const keys = Object.keys(record);
    const values = keys.map((key) => record[key]);

    const serialNoIndex = getHeaderIndex(keys, [
        "sl no", "sl. no", "sl. no.", "sl no.", "serial no", "serial number", "s no", "s.no", "slno"
    ]);
    const customerIndex = getHeaderIndex(keys, [
        "customer",
        "customer name",
        "customer_name"
    ]);
    const customerName2Index = getHeaderIndex(keys, ["customer name2", "customer name 2", "customer_name2"]);
    const customerCodeIndex = getHeaderIndex(keys, ["customer code", "customer id", "cust code", "cust id"]);
    const customerPartNoIndex = getHeaderIndex(keys, ["customer part no", "customer part no.", "customer part number", "cust part no"]);
    const helperIndex = getHeaderIndex(keys, ["helper"]);
    const lineIndex = getHeaderIndex(keys, ["line", "prod line", "production line"]);
    const modelIndex = getHeaderIndex(keys, ["model", "model no", "model name"]);
    const oemIndex = getHeaderIndex(keys, ["oem", "oem's", "oems", "oem s"]);
    const partIndex = getHeaderIndex(keys, [
        "part no",
        "part no.",
        "part number",
        "part number no",
        "part",
        "part_no",
        "part no number"
    ]);
    const applicationIndex = getHeaderIndex(keys, ["application", "product application"]);
    const descriptionIndex = getHeaderIndex(keys, ["description", "product description", "part description"]);
    const deliveryMonthIndex = getHeaderIndex(keys, ["delivery month"]);
    const scheduleStartMonthIndex = getHeaderIndex(keys, ["schedule start month"]);
    const scheduleEndMonthIndex = getHeaderIndex(keys, ["schedule end month"]);
    const versionIndex = getHeaderIndex(keys, [
        "version",
        "version no",
        "schedule version",
        "version number"
    ]);
    const previousMonthIndex = getHeaderIndex(keys, [
        "previous month",
        "prev month",
        "previous month schedule",
        "previous",
        "prev",
        "last month",
        "past month"
    ]);
    const originalCustomerScheduleIndex = getHeaderIndex(keys, [
        "original customer schedule",
        "original customer schedule qty",
        "original customer schedule quantity"
    ]);
    const currentCustomerScheduleIndex = getHeaderIndex(keys, [
        "current customer schedule",
        "current customer schedule qty",
        "current customer schedule quantity"
    ]);
    const currentMonthHeaderAliases = [
        "current month schedule quantity",
        "current month schedule qty",
        "current customer schedule quantity",
        "current customer schedule qty",
        "current month schedule",
        "current customer schedule",
        "current month",
        "schedule quantity",
        "schedule qty",
        "customer schedule quantity",
        "customer schedule qty",
        "customer schedule"
    ].map(normalizeHeader);
    const currentMonthIndex = currentCustomerScheduleIndex !== -1
        ? currentCustomerScheduleIndex
        : keys.findIndex((key) => {
            const header = normalizeHeader(key);
            return currentMonthHeaderAliases.some((alias) => header === alias || header.startsWith(`${alias} `));
        });
    const legacyCustomerScheduleIndex = keys.findIndex((key) => normalizeHeader(key) === "customer schedule");
    const scheduleIndex = currentMonthIndex !== -1 ? currentMonthIndex : legacyCustomerScheduleIndex;
    const comingMonthIndex = getHeaderIndex(keys, [
        "coming month",
        "coming month schedule",
        "next month",
        "next month schedule",
        "next",
        "future month",
        "coming"
    ]);
    const commitmentIndex = getHeaderIndex(keys, [
        "company commitment",
        "company commitment qty",
        "company commitment quantity",
        "commitment",
        "commitment qty"
    ]);
    const dispatchIndex = getHeaderIndex(keys, [
        "last month dispatch",
        "previous month dispatch",
        "last month dispatch qty",
        "previous month dispatch qty",
        "actual dispatch",
        "actual dispatch qty",
        "actual dispatch quantity",
        "dispatch",
        "dispatch qty",
        "actual dispatches",
        "actual delivery"
    ]);
    const balanceIndex = getHeaderIndex(keys, [
        "backlog",
        "backlog qty",
        "backlog quantity",
        "balance",
        "balance qty",
        "closing balance",
        "balance quantity",
        "pending balance"
    ]);
    const scheduleReceivedQtyIndex = getHeaderIndex(keys, [
        "schedule received qty",
        "schedule received quantity",
        "received schedule qty",
        "received schedule quantity"
    ]);
    const scheduleReceivedDateIndex = getHeaderIndex(keys, [
        "schedule received date",
        "received date"
    ]);
    const scheduleReceivedIndex = scheduleReceivedDateIndex !== -1
        ? scheduleReceivedDateIndex
        : keys.findIndex((key, index) =>
            normalizeHeader(key) === "schedule received" && index !== scheduleReceivedQtyIndex
        );
    const actualProductionIndex = getHeaderIndex(keys, [
        "actual production qty",
        "actual production quantity"
    ]);
    const dispatchDateIndex = getHeaderIndex(keys, ["dispatch date"]);
    const dispatchHeader = dispatchIndex !== -1 ? normalizeHeader(keys[dispatchIndex]) : "";
    const actualDispatchMonthAligned = dispatchIndex !== -1
        && !/\b(?:last|previous|prev) month\b/.test(dispatchHeader);
    const varianceReasonIndex = getHeaderIndex(keys, ["variance reason"]);
    const netCustomerRevisionIndex = getHeaderIndex(keys, ["net customer revision"]);
    const finalScheduleVarianceIndex = getHeaderIndex(keys, ["final schedule variance"]);
    const achievementIndex = getHeaderIndex(keys, ["achievement"]);
    const monthlySchedules = {};
    const monthlyCommitments = {};
    const monthlyDispatches = {};
    const monthlyDispatchDates = {};

    keys.forEach((key, index) => {
        const monthKey = getMonthKeyFromHeader(key);
        if (monthKey && hasCellValue(values[index])) monthlySchedules[monthKey] = toNumber(values[index]);
        const monthMetric = getMonthMetricFromHeader(key);
        if (monthMetric?.metric === "commitment" && hasCellValue(values[index])) {
            monthlyCommitments[monthMetric.monthKey] = toNumber(values[index]);
        } else if (monthMetric?.metric === "dispatch" && hasCellValue(values[index])) {
            monthlyDispatches[monthMetric.monthKey] = toNumber(values[index]);
        } else if (monthMetric?.metric === "dispatchDate" && hasCellValue(values[index])) {
            monthlyDispatchDates[monthMetric.monthKey] = String(values[index] || "").trim();
        }
    });

    const customer = customerIndex !== -1 ? values[customerIndex] : "";
    const customerName2 = customerName2Index !== -1 ? values[customerName2Index] : "";
    const customerCode = customerCodeIndex !== -1 ? values[customerCodeIndex] : customer;
    const partNo = partIndex !== -1 ? values[partIndex] : "";
    const version = versionIndex !== -1 ? values[versionIndex] : "Current";
    const previousMonth = previousMonthIndex !== -1 ? toNumber(values[previousMonthIndex]) : 0;
    const currentMonth = scheduleIndex !== -1 ? toNumber(values[scheduleIndex]) : 0;
    const comingMonth = comingMonthIndex !== -1 ? toNumber(values[comingMonthIndex]) : 0;
    const companyCommitmentProvided = commitmentIndex !== -1 && hasCellValue(values[commitmentIndex]);
    const actualDispatchProvided = dispatchIndex !== -1 && hasCellValue(values[dispatchIndex]);
    const companyCommitment = commitmentIndex !== -1 ? toNumber(values[commitmentIndex]) : currentMonth;
    const actualDispatch = dispatchIndex !== -1 ? toNumber(values[dispatchIndex]) : 0;
    const deliveryMonth = deliveryMonthIndex !== -1 ? String(values[deliveryMonthIndex] || "").trim() : "";
    const deliveryMonthKey = getMonthKeyFromHeader(deliveryMonth);
    if (deliveryMonthKey && scheduleIndex !== -1 && hasCellValue(values[scheduleIndex])
        && !Object.prototype.hasOwnProperty.call(monthlySchedules, deliveryMonthKey)) {
        monthlySchedules[deliveryMonthKey] = currentMonth;
    }
    
    const backlogValue = balanceIndex !== -1 ? values[balanceIndex] : null;
    const balance = backlogValue !== null && String(backlogValue).trim() !== ""
        ? toNumber(backlogValue)
        : null;

    return {
        serialNo: serialNoIndex !== -1 ? String(values[serialNoIndex] || "").trim() : "",
        customer: String(customerName2 || customer || "").trim(),
        customerGroup: String(customer || "").trim(),
        customerName2: String(customerName2 || "").trim(),
        customerCode: String(customerCode || "").trim(),
        customerPartNo: customerPartNoIndex !== -1 ? String(values[customerPartNoIndex] || "").trim() : "",
        helper: helperIndex !== -1 ? String(values[helperIndex] || "").trim() : "",
        line: lineIndex !== -1 ? String(values[lineIndex] || "").trim() : "",
        model: modelIndex !== -1 ? String(values[modelIndex] || "").trim() : "",
        oem: oemIndex !== -1 ? String(values[oemIndex] || "").trim() : "",
        partNo: String(partNo || "").trim(),
        application: applicationIndex !== -1 ? String(values[applicationIndex] || "").trim() : "",
        productDescription: descriptionIndex !== -1 ? String(values[descriptionIndex] || "").trim() : "",
        version: String(version || "Current").trim(),
        deliveryMonth,
        scheduleReceivedDate: scheduleReceivedIndex !== -1 ? String(values[scheduleReceivedIndex] || "").trim() : "",
        scheduleStartMonth: scheduleStartMonthIndex !== -1 ? String(values[scheduleStartMonthIndex] || "").trim() : "",
        scheduleEndMonth: scheduleEndMonthIndex !== -1 ? String(values[scheduleEndMonthIndex] || "").trim() : "",
        scheduleReceivedQty: scheduleReceivedQtyIndex !== -1
            ? toNumber(values[scheduleReceivedQtyIndex])
            : originalCustomerScheduleIndex !== -1
                ? toNumber(values[originalCustomerScheduleIndex])
                : null,
        originalCustomerSchedule: originalCustomerScheduleIndex !== -1
            ? toNumber(values[originalCustomerScheduleIndex])
            : null,
        currentCustomerSchedule: currentCustomerScheduleIndex !== -1
            ? toNumber(values[currentCustomerScheduleIndex])
            : null,
        monthlySchedules,
        monthlyCommitments,
        monthlyDispatches,
        monthlyDispatchDates,
        actualProductionQty: actualProductionIndex !== -1 ? toNumber(values[actualProductionIndex]) : 0,
        dispatchDate: dispatchDateIndex !== -1 ? String(values[dispatchDateIndex] || "").trim() : "",
        varianceReason: varianceReasonIndex !== -1 ? String(values[varianceReasonIndex] || "").trim() : "",
        netCustomerRevision: netCustomerRevisionIndex !== -1 ? toNumber(values[netCustomerRevisionIndex]) : null,
        finalScheduleVariance: finalScheduleVarianceIndex !== -1 ? toNumber(values[finalScheduleVarianceIndex]) : null,
        achievement: achievementIndex !== -1 ? toNumber(values[achievementIndex]) : null,
        previousMonth,
        currentMonth,
        comingMonth,
        customerSchedule: currentMonth,
        companyCommitment,
        companyCommitmentProvided,
        actualDispatch,
        actualDispatchProvided,
        actualDispatchMonthAligned,
        balance
    };
}

function getScheduleRowKey(row) {
    return [
        row.customerCode || row.customer || "",
        row.partNo || "",
        row.version || "Current",
        row.deliveryMonth || "No month supplied"
    ].map(value => String(value).trim().toLowerCase()).join("|");
}

function mergeScheduleRows(existingRows, incomingRows) {
    const merged = [...existingRows];
    const indexes = new Map(merged.map((row, index) => [getScheduleRowKey(row), index]));

    for (const row of incomingRows) {
        const key = getScheduleRowKey(row);
        const existingIndex = indexes.get(key);
        if (existingIndex === undefined) {
            indexes.set(key, merged.length);
            merged.push(row);
        } else {
            merged[existingIndex] = row;
        }
    }

    return merged;
}

function saveScheduleData(rows) {
    const tempPath = `${scheduleDataPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(rows, null, 2), "utf8");
    fs.renameSync(tempPath, scheduleDataPath);
}

function saveScheduleSnapshot(snapshot) {
    const updatedSnapshots = [...scheduleSnapshots, snapshot];
    const tempPath = `${scheduleSnapshotsPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(updatedSnapshots, null, 2), "utf8");
    fs.renameSync(tempPath, scheduleSnapshotsPath);
    scheduleSnapshots = updatedSnapshots;
}

function saveScheduleSnapshotData(snapshots) {
    const tempPath = `${scheduleSnapshotsPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(snapshots, null, 2), "utf8");
    fs.renameSync(tempPath, scheduleSnapshotsPath);
    scheduleSnapshots = snapshots;
}

function loadScheduleData() {
    if (!fs.existsSync(scheduleDataPath)) return [];

    const savedRows = JSON.parse(fs.readFileSync(scheduleDataPath, "utf8"));
    if (!Array.isArray(savedRows)) {
        throw new Error(`Schedule history file must contain an array: ${scheduleDataPath}`);
    }
    return savedRows;
}

function loadScheduleSnapshots() {
    if (!fs.existsSync(scheduleSnapshotsPath)) return [];

    const savedSnapshots = JSON.parse(fs.readFileSync(scheduleSnapshotsPath, "utf8"));
    if (!Array.isArray(savedSnapshots)) {
        throw new Error(`Schedule snapshots file must contain an array: ${scheduleSnapshotsPath}`);
    }
    return savedSnapshots;
}

function parseMonth(val) {
    if (!val) return null;
    const num = Number(val);
    if (!isNaN(num) && num > 40000 && num < 60000) {
        const d = XLSX.SSF.parse_date_code(num);
        return d ? `${d.y}-${String(d.m).padStart(2, "0")}` : null;
    }
    const str = String(val).trim().toLowerCase();
    const m = str.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s'/-]*(\d{2}|\d{4})\b/i);
    if (m) {
        const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
        const mIdx = months.indexOf(m[1].slice(0, 3).toLowerCase());
        const yr = m[2].length === 2 ? Number(`20${m[2]}`) : Number(m[2]);
        return `${yr}-${String(mIdx + 1).padStart(2, "0")}`;
    }
    return null;
}

function parseScheduleWorkbook(workbook) {
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(15, rawRows.length); i++) {
        const rowStr = rawRows[i].map(c => String(c).toLowerCase()).join(" ");
        if (rowStr.includes("customer") && (rowStr.includes("part") || rowStr.includes("part no"))) {
            headerRowIdx = i;
            break;
        }
    }

    if (headerRowIdx === -1) {
        const legacyRows = getScheduleRecords(workbook.Sheets[sheetName], XLSX);
        return legacyRows.map(mapScheduleRow).filter(r => r.customer || r.partNo);
    }

    const headers = rawRows[headerRowIdx];
    const prevRow = headerRowIdx > 0 ? rawRows[headerRowIdx - 1] : [];

    const colMappings = [];
    let activeMonth = null;
    for (let c = 0; c < headers.length; c++) {
        const h = headers[c];
        const norm = String(h || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

        const mFromH = parseMonth(h);
        const mFromPrev = parseMonth(prevRow[c]);
        if (mFromPrev) activeMonth = mFromPrev;
        else if (mFromH) activeMonth = mFromH;

        let field = null;
        if (/^(sl\s*no|serial|s\s*no)/.test(norm)) field = "serialNo";
        else if (norm === "customer" || norm === "customer name") field = "customer";
        else if (norm.includes("customer code")) field = "customerCode";
        else if (norm.includes("customer name2") || norm.includes("customer name 2")) field = "customerName2";
        else if (norm.includes("customer part")) field = "customerPartNo";
        else if (/^part\s*no/.test(norm) || norm === "part" || norm === "part no.") field = "partNo";
        else if (norm === "helper") field = "helper";
        else if (norm === "line") field = "line";
        else if (norm === "model") field = "model";
        else if (norm.includes("oem")) field = "oem";
        else if (norm.includes("desc") || norm.includes("description")) field = "productDescription";
        else if (norm.includes("dispatch") || norm.includes("actual dispatch")) {
            field = { type: "dispatch", month: activeMonth };
        } else if (norm.includes("actual customer") || norm.includes("customer scheule") || norm.includes("customer schedule")) {
            field = { type: "schedule", month: activeMonth };
        } else if (norm.includes("commitment") || (mFromH && norm.includes("schedule"))) {
            field = { type: "commitment", month: activeMonth };
        } else if (mFromH) {
            field = { type: "demand", month: mFromH };
        }

        colMappings.push(field);
    }

    const rows = [];
    for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
        const raw = rawRows[r];
        if (!raw || raw.every(c => c === "" || c === null || c === undefined)) continue;

        const monthlySchedules = {};
        const monthlyCommitments = {};
        const monthlyDispatches = {};
        const obj = {
            serialNo: "", customer: "", customerGroup: "", customerName2: "", customerCode: "",
            customerPartNo: "", helper: "", line: "", model: "", oem: "", partNo: "",
            application: "", productDescription: "", version: "Current", deliveryMonth: "",
            scheduleReceivedDate: "", scheduleStartMonth: "", scheduleEndMonth: "",
            scheduleReceivedQty: null, originalCustomerSchedule: null, currentCustomerSchedule: null,
            actualProductionQty: 0, dispatchDate: "", varianceReason: "",
            previousMonth: 0, currentMonth: 0, comingMonth: 0, customerSchedule: 0,
            companyCommitment: 0, companyCommitmentProvided: false,
            actualDispatch: 0, actualDispatchProvided: false, actualDispatchMonthAligned: true,
            balance: null
        };

        colMappings.forEach((mapping, c) => {
            const val = raw[c];
            if (typeof mapping === "string") {
                obj[mapping] = String(val || "").trim();
            } else if (mapping && typeof mapping === "object" && mapping.month) {
                const num = Number(String(val || "").replace(/[^0-9.-]/g, "")) || 0;
                if (mapping.type === "schedule") monthlySchedules[mapping.month] = num;
                else if (mapping.type === "commitment") monthlyCommitments[mapping.month] = num;
                else if (mapping.type === "dispatch") monthlyDispatches[mapping.month] = num;
                else if (mapping.type === "demand") {
                    monthlySchedules[mapping.month] = num;
                    monthlyCommitments[mapping.month] = num;
                }
            }
        });

        if (!obj.customer && !obj.partNo) continue;
        obj.customerGroup = obj.customer;

        const months = Object.keys(monthlySchedules).sort();
        if (months.length > 0) {
            obj.deliveryMonth = months[0];
            obj.currentMonth = monthlySchedules[months[0]] || 0;
            obj.customerSchedule = obj.currentMonth;
            if (months.length > 1) obj.comingMonth = monthlySchedules[months[1]] || 0;
            if (monthlyCommitments[months[0]] !== undefined) {
                obj.companyCommitment = monthlyCommitments[months[0]];
                obj.companyCommitmentProvided = true;
            } else {
                obj.companyCommitment = obj.currentMonth;
            }
            if (monthlyDispatches[months[0]] !== undefined) {
                obj.actualDispatch = monthlyDispatches[months[0]];
                obj.actualDispatchProvided = true;
                obj.balance = obj.currentMonth - obj.actualDispatch;
            }
        }

        obj.monthlySchedules = monthlySchedules;
        obj.monthlyCommitments = monthlyCommitments;
        obj.monthlyDispatches = monthlyDispatches;

        rows.push(obj);
    }
    return rows;
}

function getDashboardSummary(rows) {
    const customerList = Array.from(new Set(rows.map((row) => row.customer).filter(Boolean)));
    const parts = new Set(rows.map((row) => row.partNo).filter(Boolean)).size;
    const totalPreviousMonth = rows.reduce((sum, row) => sum + (row.previousMonth || 0), 0);
    const totalCurrentMonth = rows.reduce((sum, row) => sum + (row.currentMonth || row.customerSchedule || 0), 0);
    const totalComingMonth = rows.reduce((sum, row) => sum + (row.comingMonth || 0), 0);
    const totalDispatch = rows.reduce((sum, row) => sum + (row.actualDispatch || 0), 0);
    const totalBalance = rows.reduce((sum, row) => sum + (row.balance || 0), 0);

    return {
        customer: customerList.length > 0 ? customerList[0] : "",
        customers: customerList.length,
        customerList,
        parts,
        previousMonth: totalPreviousMonth,
        currentMonth: totalCurrentMonth,
        comingMonth: totalComingMonth,
        actualDispatch: totalDispatch,
        balance: totalBalance,
        schedule: totalCurrentMonth,
        dispatch: totalDispatch
    };
}

function normalizeValue(value, fallback = "") {
    return value === null || value === undefined || value === "" ? fallback : String(value).trim();
}

function makeCustomerCode(customerName) {
    const code = normalizeValue(customerName, "CUST")
        .replace(/[^a-zA-Z0-9]/g, "")
        .toUpperCase();
    return code ? code.substring(0, 30) : "CUST";
}

async function saveScheduleRowsToOracle(rows) {
    if (!pool) {
        throw new Error("Oracle database is not configured or not reachable.");
    }

    const connection = await pool.getConnection();

    try {
        for (const row of rows) {
            const customerCode = makeCustomerCode(row.customer);
            const customerName = normalizeValue(row.customer, "Unknown Customer");
            const partNo = normalizeValue(row.partNo, "UNKNOWN");
            const version = normalizeValue(row.version, "Current");

            let customerId;
            const customerResult = await connection.execute(
                `SELECT customer_id FROM customers WHERE customer_code = :customerCode`,
                { customerCode }
            );

            if (customerResult.rows && customerResult.rows.length > 0) {
                customerId = customerResult.rows[0][0];
            } else {
                const customerInsert = await connection.execute(
                    `INSERT INTO customers (customer_id, customer_code, customer_name, location, created_at)
                     VALUES (customer_seq.NEXTVAL, :customerCode, :customerName, :location, SYSDATE)
                     RETURNING customer_id INTO :customerId`,
                    {
                        customerCode,
                        customerName,
                        location: "N/A",
                        customerId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
                    }
                );
                customerId = customerInsert.outBinds.customerId[0];
            }

            let partId;
            const partResult = await connection.execute(
                `SELECT part_id FROM parts WHERE part_no = :partNo`,
                { partNo }
            );

            if (partResult.rows && partResult.rows.length > 0) {
                partId = partResult.rows[0][0];
            } else {
                const partInsert = await connection.execute(
                    `INSERT INTO parts (part_id, part_no, product_description, application, created_at)
                     VALUES (part_seq.NEXTVAL, :partNo, :productDescription, :application, SYSDATE)
                     RETURNING part_id INTO :partId`,
                    {
                        partNo,
                        productDescription: `Imported part ${partNo}`,
                        application: "Schedule upload",
                        partId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
                    }
                );
                partId = partInsert.outBinds.partId[0];
            }

            let scheduleId;
            const scheduleResult = await connection.execute(
                `SELECT schedule_id FROM schedules
                 WHERE customer_id = :customerId AND part_id = :partId AND schedule_version = :version`,
                { customerId, partId, version }
            );

            if (scheduleResult.rows && scheduleResult.rows.length > 0) {
                scheduleId = scheduleResult.rows[0][0];
            } else {
                const scheduleInsert = await connection.execute(
                    `INSERT INTO schedules (schedule_id, customer_id, part_id, schedule_version, schedule_received_date, schedule_start_month, schedule_end_month, is_current)
                     VALUES (schedule_seq.NEXTVAL, :customerId, :partId, :version, SYSDATE, TRUNC(SYSDATE, 'MM'), ADD_MONTHS(TRUNC(SYSDATE,'MM'), 1), 'Y')
                     RETURNING schedule_id INTO :scheduleId`,
                    {
                        customerId,
                        partId,
                        version,
                        scheduleId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
                    }
                );
                scheduleId = scheduleInsert.outBinds.scheduleId[0];
            }

            const scheduleDetailInsert = await connection.execute(
                `INSERT INTO schedule_details (schedule_detail_id, schedule_id, delivery_month, customer_schedule, company_commitment)
                 VALUES (schedule_detail_seq.NEXTVAL, :scheduleId, TRUNC(SYSDATE, 'MM'), :customerSchedule, :companyCommitment)
                 RETURNING schedule_detail_id INTO :scheduleDetailId`,
                {
                    scheduleId,
                    customerSchedule: row.customerSchedule,
                    companyCommitment: row.companyCommitment,
                    scheduleDetailId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
                }
            );

            const scheduleDetailId = scheduleDetailInsert.outBinds.scheduleDetailId[0];
            const actualDispatch = row.actualDispatch || 0;

            await connection.execute(
                `INSERT INTO performance (performance_id, schedule_detail_id, actual_production_qty, actual_dispatch_qty, dispatch_date, variance_reason)
                 VALUES (performance_seq.NEXTVAL, :scheduleDetailId, :actualProduction, :actualDispatch, NVL(TO_DATE(:dispatchDate, 'YYYY-MM-DD'), SYSDATE), :varianceReason)`,
                {
                    scheduleDetailId,
                    actualProduction: row.actualProduction || 0,
                    actualDispatch,
                    dispatchDate: row.dispatchDate || null,
                    varianceReason: row.varianceReason || (row.balance >= 0 ? "Within plan" : "Shortfall")
                }
            );
        }

        await connection.commit();
    } finally {
        connection.release();
    }
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const allowed = [".xlsx", ".xls", ".csv"];
        const extension = path.extname(file.originalname).toLowerCase();
        if (!allowed.includes(extension)) {
            return cb(new Error("Unsupported file type. Choose an .xlsx, .xls, or .csv spreadsheet."));
        }
        cb(null, true);
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

// Serve index.html explicitly for root route
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// Download sample Excel schedule template
app.get("/api/sample-template", (req, res) => {
    try {
        const headers = [[
            "Sl No", "Customer", "Customer code", "PART No.", "Helper",
            "Customer Part No", "Line", "Description", "Application",
            "Schedule Received Date", "Schedule Start Month", "Schedule End Month", "Schedule Version",
            "Previous Month", "Current Month", "Coming Month", "Original Customer Schedule",
            "Current Customer Schedule", "Actual Production Qty", "Actual Dispatch Qty",
            "Dispatch Date", "Variance Reason", "Net Customer Revision",
            "Final Schedule Variance", "Achievement", "Backlog"
        ]];
        const worksheet = XLSX.utils.aoa_to_sheet(headers);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Schedule");
        const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

        res.setHeader("Content-Disposition", "attachment; filename=\"IFB_Schedule_Template.xlsx\"");
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.send(buffer);
    } catch (err) {
        res.status(500).json({ error: "Failed to generate template", details: err.message });
    }
});

app.delete("/api/schedule-row/:index", (req, res) => {
    const idx = parseInt(req.params.index, 10);
    if (!isNaN(idx) && idx >= 0 && idx < latestScheduleData.length) {
        const updatedRows = latestScheduleData.filter((_, index) => index !== idx);
        try {
            saveScheduleData(updatedRows);
        } catch (error) {
            console.error("Unable to persist schedule deletion:", error.message);
            return res.status(500).json({ error: "Unable to save schedule history after deletion." });
        }
        latestScheduleData = updatedRows;
        return res.json({ success: true, rows: latestScheduleData, summary: getDashboardSummary(latestScheduleData) });
    }
    return res.status(400).json({ error: "Invalid row index" });
});

app.get("/master-data", (req, res) => {
    const customersByCode = new Map();
    const catalog = {};

    const allKnownRows = [
        ...latestScheduleData,
        ...scheduleSnapshots.flatMap(snapshot => snapshot.rows || [])
    ];
    for (const row of allKnownRows) {
        const name = row.customer || row.customerCode;
        const code = row.customerCode || makeCustomerCode(name);
        if (name && !customersByCode.has(code)) customersByCode.set(code, { name, code });
        if (row.partNo) {
            const application = row.application || "Imported";
            if (!catalog[application]) catalog[application] = [];
            if (!catalog[application].some((part) => part.partNo === row.partNo)) {
                catalog[application].push({
                    partNo: row.partNo,
                    description: row.productDescription || ""
                });
            }
        }
    }

    res.json({
        customers: Array.from(customersByCode.values()),
        catalog,
        varianceReasons: []
    });
});

app.get("/dashboard", (req, res) => {
    res.json({
        summary: getDashboardSummary(latestScheduleData),
        rows: latestScheduleData
    });
});

app.get("/analytics/historical", (req, res) => {
    const month = String(req.query.month || "");
    const customer = String(req.query.customer || "ALL");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        return res.status(400).json({ message: "A valid delivery month is required (YYYY-MM)." });
    }
    return res.json(calculateScheduleAnalytics(
        scheduleSnapshots,
        month,
        customer,
        new Date(),
        {
            previousSnapshotId: String(req.query.previousSnapshotId || ""),
            currentSnapshotId: String(req.query.currentSnapshotId || "")
        }
    ));
});

app.get("/analytics/snapshots", (req, res) => {
    const month = String(req.query.month || "");
    const customer = String(req.query.customer || "ALL");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        return res.status(400).json({ message: "A valid delivery month is required (YYYY-MM)." });
    }
    return res.json({
        snapshots: getDemandSnapshotTimeline(scheduleSnapshots, month, customer)
    });
});

app.get("/analytics/compare-different-sheets", (req, res) => {
    const { baseSnapshotId, compareSnapshotId, month, customer } = req.query;
    const result = compareDifferentSheets(scheduleSnapshots, {
        baseSnapshotId: baseSnapshotId ? String(baseSnapshotId) : undefined,
        compareSnapshotId: compareSnapshotId ? String(compareSnapshotId) : undefined,
        month: month ? String(month) : "ALL",
        customer: customer ? String(customer) : "ALL"
    });
    return res.json(result);
});

app.get("/analytics/compare-within-sheet", (req, res) => {
    const { snapshotId, mode, monthA, monthB, metricA, metricB, month, customer } = req.query;
    const result = compareWithinSameSheet(scheduleSnapshots, {
        snapshotId: snapshotId ? String(snapshotId) : undefined,
        mode: mode ? String(mode) : "months",
        monthA: monthA ? String(monthA) : undefined,
        monthB: monthB ? String(monthB) : undefined,
        metricA: metricA ? String(metricA) : "commitment",
        metricB: metricB ? String(metricB) : "dispatch",
        month: month ? String(month) : "ALL",
        customer: customer ? String(customer) : "ALL"
    });
    return res.json(result);
});

app.get("/analytics/comparison-meta", (req, res) => {
    const { snapshotId } = req.query;
    return res.json(getSnapshotComparisonMeta(scheduleSnapshots, snapshotId ? String(snapshotId) : undefined));
});

app.post("/api/load-sample-demo", (req, res) => {
    const demoSnapshots = [
        {
            snapshotId: "demo-rev1-2026-10-01",
            snapshotDate: "2026-10-01",
            capturedAt: "2026-10-01T09:00:00.000Z",
            source: "Motor_Monthly_Plan_Oct26_Rev-01.xlsx",
            rows: [
                {
                    serialNo: "1", customer: "Whirlpool India", customerGroup: "Whirlpool India", customerCode: "CUST-WPL",
                    customerName2: "Whirlpool Pune Plant", partNo: "MTR-101-50W", customerPartNo: "WPL-7701",
                    helper: "H-01", line: "Line-A", model: "Semi-Auto WM", oem: "OEM-W",
                    productDescription: "Wash Motor 50W Standard Stator", deliveryMonth: "Oct-26", version: "Rev-01",
                    previousMonth: 950, currentMonth: 1200, comingMonth: 1300,
                    companyCommitment: 1200, companyCommitmentProvided: true,
                    actualDispatch: 1150, actualDispatchProvided: true, actualDispatchMonthAligned: true,
                    dispatchDate: "2026-10-28", actualProductionQty: 1180, balance: 50,
                    monthlySchedules: { "2026-10": 1200, "2026-11": 1300, "2026-12": 1100 },
                    monthlyCommitments: { "2026-10": 1200, "2026-11": 1250, "2026-12": 1100 },
                    monthlyDispatches: { "2026-10": 1150 }
                },
                {
                    serialNo: "2", customer: "Whirlpool India", customerGroup: "Whirlpool India", customerCode: "CUST-WPL",
                    customerName2: "Whirlpool Pune Plant", partNo: "MTR-102-Spin", customerPartNo: "WPL-7702",
                    helper: "H-01", line: "Line-A", model: "Semi-Auto WM", oem: "OEM-W",
                    productDescription: "Spin Motor 40W High RPM", deliveryMonth: "Oct-26", version: "Rev-01",
                    previousMonth: 800, currentMonth: 900, comingMonth: 950,
                    companyCommitment: 900, companyCommitmentProvided: true,
                    actualDispatch: 900, actualDispatchProvided: true, actualDispatchMonthAligned: true,
                    dispatchDate: "2026-10-25", actualProductionQty: 920, balance: 0,
                    monthlySchedules: { "2026-10": 900, "2026-11": 950, "2026-12": 900 },
                    monthlyCommitments: { "2026-10": 900, "2026-11": 950, "2026-12": 900 },
                    monthlyDispatches: { "2026-10": 900 }
                },
                {
                    serialNo: "3", customer: "Bosch Home", customerGroup: "Bosch Home", customerCode: "CUST-BSH",
                    customerName2: "BSH Chennai", partNo: "MTR-201-BLDC", customerPartNo: "BSH-B300",
                    helper: "H-02", line: "Line-B", model: "Front Load WM", oem: "OEM-B",
                    productDescription: "BLDC Inverter Direct Drive Motor", deliveryMonth: "Oct-26", version: "Rev-01",
                    previousMonth: 1500, currentMonth: 1600, comingMonth: 1800,
                    companyCommitment: 1500, companyCommitmentProvided: true,
                    actualDispatch: 1420, actualDispatchProvided: true, actualDispatchMonthAligned: true,
                    dispatchDate: "2026-10-30", actualProductionQty: 1450, balance: 80,
                    monthlySchedules: { "2026-10": 1600, "2026-11": 1800, "2026-12": 2000 },
                    monthlyCommitments: { "2026-10": 1500, "2026-11": 1700, "2026-12": 1900 },
                    monthlyDispatches: { "2026-10": 1420 }
                },
                {
                    serialNo: "4", customer: "Godrej Appliances", customerGroup: "Godrej Appliances", customerCode: "CUST-GDJ",
                    customerName2: "Godrej Shirwal Plant", partNo: "MTR-301-70W", customerPartNo: "GDJ-M50",
                    helper: "H-03", line: "Line-C", model: "Top Load WM", oem: "OEM-G",
                    productDescription: "Induction Motor 70W Top Load", deliveryMonth: "Oct-26", version: "Rev-01",
                    previousMonth: 700, currentMonth: 850, comingMonth: 850,
                    companyCommitment: 850, companyCommitmentProvided: true,
                    actualDispatch: 850, actualDispatchProvided: true, actualDispatchMonthAligned: true,
                    dispatchDate: "2026-10-22", actualProductionQty: 870, balance: 0,
                    monthlySchedules: { "2026-10": 850, "2026-11": 850, "2026-12": 800 },
                    monthlyCommitments: { "2026-10": 850, "2026-11": 850, "2026-12": 800 },
                    monthlyDispatches: { "2026-10": 850 }
                },
                {
                    serialNo: "5", customer: "Samsung India", customerGroup: "Samsung India", customerCode: "CUST-SAM",
                    customerName2: "Samsung Noida", partNo: "MTR-401-DD", customerPartNo: "SAM-DD99",
                    helper: "H-04", line: "Line-B", model: "EcoBubble WM", oem: "OEM-S",
                    productDescription: "Digital Inverter Motor 85W", deliveryMonth: "Oct-26", version: "Rev-01",
                    previousMonth: 600, currentMonth: 750, comingMonth: 800,
                    companyCommitment: 750, companyCommitmentProvided: true,
                    actualDispatch: 700, actualDispatchProvided: true, actualDispatchMonthAligned: true,
                    dispatchDate: "2026-10-29", actualProductionQty: 720, balance: 50,
                    monthlySchedules: { "2026-10": 750, "2026-11": 800, "2026-12": 850 },
                    monthlyCommitments: { "2026-10": 750, "2026-11": 800, "2026-12": 850 },
                    monthlyDispatches: { "2026-10": 700 }
                }
            ]
        },
        {
            snapshotId: "demo-rev2-2026-10-10",
            snapshotDate: "2026-10-10",
            capturedAt: "2026-10-10T14:30:00.000Z",
            source: "Motor_Monthly_Plan_Oct26_Rev-02.xlsx",
            rows: [
                {
                    serialNo: "1", customer: "Whirlpool India", customerGroup: "Whirlpool India", customerCode: "CUST-WPL",
                    customerName2: "Whirlpool Pune Plant", partNo: "MTR-101-50W", customerPartNo: "WPL-7701",
                    helper: "H-01", line: "Line-A", model: "Semi-Auto WM", oem: "OEM-W",
                    productDescription: "Wash Motor 50W Standard Stator", deliveryMonth: "Oct-26", version: "Rev-02",
                    previousMonth: 950, currentMonth: 1400, comingMonth: 1500, // +200 revision
                    companyCommitment: 1350, companyCommitmentProvided: true,
                    actualDispatch: 1320, actualDispatchProvided: true, actualDispatchMonthAligned: true,
                    dispatchDate: "2026-10-28", actualProductionQty: 1350, balance: 30,
                    monthlySchedules: { "2026-10": 1400, "2026-11": 1500, "2026-12": 1300 },
                    monthlyCommitments: { "2026-10": 1350, "2026-11": 1450, "2026-12": 1300 },
                    monthlyDispatches: { "2026-10": 1320 }
                },
                {
                    serialNo: "2", customer: "Whirlpool India", customerGroup: "Whirlpool India", customerCode: "CUST-WPL",
                    customerName2: "Whirlpool Pune Plant", partNo: "MTR-102-Spin", customerPartNo: "WPL-7702",
                    helper: "H-01", line: "Line-A", model: "Semi-Auto WM", oem: "OEM-W",
                    productDescription: "Spin Motor 40W High RPM", deliveryMonth: "Oct-26", version: "Rev-02",
                    previousMonth: 800, currentMonth: 900, comingMonth: 950, // unchanged
                    companyCommitment: 900, companyCommitmentProvided: true,
                    actualDispatch: 900, actualDispatchProvided: true, actualDispatchMonthAligned: true,
                    dispatchDate: "2026-10-25", actualProductionQty: 920, balance: 0,
                    monthlySchedules: { "2026-10": 900, "2026-11": 950, "2026-12": 900 },
                    monthlyCommitments: { "2026-10": 900, "2026-11": 950, "2026-12": 900 },
                    monthlyDispatches: { "2026-10": 900 }
                },
                {
                    serialNo: "3", customer: "Bosch Home", customerGroup: "Bosch Home", customerCode: "CUST-BSH",
                    customerName2: "BSH Chennai", partNo: "MTR-201-BLDC", customerPartNo: "BSH-B300",
                    helper: "H-02", line: "Line-B", model: "Front Load WM", oem: "OEM-B",
                    productDescription: "BLDC Inverter Direct Drive Motor", deliveryMonth: "Oct-26", version: "Rev-02",
                    previousMonth: 1500, currentMonth: 1450, comingMonth: 1650, // -150 revision
                    companyCommitment: 1450, companyCommitmentProvided: true,
                    actualDispatch: 1420, actualDispatchProvided: true, actualDispatchMonthAligned: true,
                    dispatchDate: "2026-10-30", actualProductionQty: 1450, balance: 30,
                    monthlySchedules: { "2026-10": 1450, "2026-11": 1650, "2026-12": 1850 },
                    monthlyCommitments: { "2026-10": 1450, "2026-11": 1650, "2026-12": 1850 },
                    monthlyDispatches: { "2026-10": 1420 }
                },
                {
                    serialNo: "4", customer: "Godrej Appliances", customerGroup: "Godrej Appliances", customerCode: "CUST-GDJ",
                    customerName2: "Godrej Shirwal Plant", partNo: "MTR-301-70W", customerPartNo: "GDJ-M50",
                    helper: "H-03", line: "Line-C", model: "Top Load WM", oem: "OEM-G",
                    productDescription: "Induction Motor 70W Top Load", deliveryMonth: "Oct-26", version: "Rev-02",
                    previousMonth: 700, currentMonth: 850, comingMonth: 850,
                    companyCommitment: 850, companyCommitmentProvided: true,
                    actualDispatch: 850, actualDispatchProvided: true, actualDispatchMonthAligned: true,
                    dispatchDate: "2026-10-22", actualProductionQty: 870, balance: 0,
                    monthlySchedules: { "2026-10": 850, "2026-11": 850, "2026-12": 800 },
                    monthlyCommitments: { "2026-10": 850, "2026-11": 850, "2026-12": 800 },
                    monthlyDispatches: { "2026-10": 850 }
                },
                {
                    serialNo: "5", customer: "Samsung India", customerGroup: "Samsung India", customerCode: "CUST-SAM",
                    customerName2: "Samsung Noida", partNo: "MTR-401-DD", customerPartNo: "SAM-DD99",
                    helper: "H-04", line: "Line-B", model: "EcoBubble WM", oem: "OEM-S",
                    productDescription: "Digital Inverter Motor 85W", deliveryMonth: "Oct-26", version: "Rev-02",
                    previousMonth: 600, currentMonth: 820, comingMonth: 900, // +70 revision
                    companyCommitment: 800, companyCommitmentProvided: true,
                    actualDispatch: 780, actualDispatchProvided: true, actualDispatchMonthAligned: true,
                    dispatchDate: "2026-10-29", actualProductionQty: 800, balance: 20,
                    monthlySchedules: { "2026-10": 820, "2026-11": 900, "2026-12": 950 },
                    monthlyCommitments: { "2026-10": 800, "2026-11": 900, "2026-12": 950 },
                    monthlyDispatches: { "2026-10": 780 }
                },
                {
                    serialNo: "6", customer: "IFB Internal", customerGroup: "IFB Internal", customerCode: "CUST-IFB",
                    customerName2: "IFB Verna Goa", partNo: "MTR-501-Aqua", customerPartNo: "IFB-AQ01",
                    helper: "H-05", line: "Line-A", model: "Front Load Senator", oem: "IFB",
                    productDescription: "Permanent Magnet Motor 90W Ultra Silent", deliveryMonth: "Oct-26", version: "Rev-02",
                    previousMonth: 0, currentMonth: 300, comingMonth: 450, // newly introduced part!
                    companyCommitment: 300, companyCommitmentProvided: true,
                    actualDispatch: 290, actualDispatchProvided: true, actualDispatchMonthAligned: true,
                    dispatchDate: "2026-10-27", actualProductionQty: 300, balance: 10,
                    monthlySchedules: { "2026-10": 300, "2026-11": 450, "2026-12": 500 },
                    monthlyCommitments: { "2026-10": 300, "2026-11": 450, "2026-12": 500 },
                    monthlyDispatches: { "2026-10": 290 }
                }
            ]
        }
    ];

    scheduleSnapshots = demoSnapshots;
    saveScheduleSnapshotData(scheduleSnapshots);

    const merged = mergeScheduleRows([], demoSnapshots[1].rows);
    latestScheduleData = merged;
    saveScheduleData(merged);

    return res.json({
        success: true,
        message: "Loaded 2 realistic demo Excel schedule revisions successfully.",
        snapshotsCount: scheduleSnapshots.length,
        recordsCount: latestScheduleData.length
    });
});

app.get("/api/imported-files", (req, res) => {
    const list = scheduleSnapshots.map((s, index) => ({
        snapshotId: s.snapshotId,
        source: s.source || "Excel upload",
        snapshotDate: s.snapshotDate || s.capturedAt?.slice(0, 10) || "-",
        capturedAt: s.capturedAt || "-",
        rowCount: s.rows ? s.rows.length : 0,
        filename: s.source || `Schedule_${s.snapshotDate || index + 1}.xlsx`
    }));
    res.json(list.slice().reverse());
});

app.get("/api/download-file/:snapshotId", (req, res) => {
    const { snapshotId } = req.params;
    const snapshot = scheduleSnapshots.find(s => s.snapshotId === snapshotId);
    if (!snapshot) {
        return res.status(404).json({ error: "Snapshot not found" });
    }

    const safeSource = path.basename(snapshot.source || "schedule.xlsx");
    const possiblePaths = [
        path.join(uploadDir, `${snapshotId}-${safeSource}`),
        path.join(uploadDir, safeSource)
    ];
    for (const p of possiblePaths) {
        if (safeSource && fs.existsSync(p)) {
            return res.download(p, safeSource);
        }
    }

    try {
        const rows = (snapshot.rows || []).map((r, i) => {
            const rowData = {
                "Sl No": r.serialNo || i + 1,
                "Customer": r.customerGroup || r.customer || "",
                "Customer code": r.customerCode || "",
                "PART No.": r.partNo || "",
                "Helper": r.helper || "",
                "Customer Part No": r.customerPartNo || "",
                "Line": r.line || "",
                "Description": r.productDescription || ""
            };
            if (r.monthlySchedules && typeof r.monthlySchedules === "object") {
                Object.entries(r.monthlySchedules).forEach(([m, q]) => {
                    rowData[m] = q;
                });
            }
            rowData["Delivery Month"] = r.deliveryMonth || "";
            rowData["Version"] = r.version || "Current";
            rowData["Actual Dispatch"] = r.actualDispatch || 0;
            rowData["Balance"] = r.balance ?? "";
            return rowData;
        });

        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Schedule");
        const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

        const downloadName = safeSource.endsWith(".xlsx") ? safeSource : `${safeSource}.xlsx`;
        res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        return res.send(buffer);
    } catch (err) {
        return res.status(500).json({ error: "Failed to generate Excel download", details: err.message });
    }
});

app.delete("/api/imported-file/:snapshotId", (req, res) => {
    const { snapshotId } = req.params;
    const index = scheduleSnapshots.findIndex(s => s.snapshotId === snapshotId);
    if (index === -1) {
        return res.status(404).json({ error: "Snapshot not found" });
    }

    const removedSnapshot = scheduleSnapshots[index];
    const updatedSnapshots = scheduleSnapshots.filter(s => s.snapshotId !== snapshotId);
    saveScheduleSnapshotData(updatedSnapshots);

    const safeSource = path.basename(removedSnapshot.source || "");
    const possiblePaths = [
        path.join(uploadDir, `${snapshotId}-${safeSource}`),
        path.join(uploadDir, safeSource)
    ];
    possiblePaths.forEach(p => {
        if (safeSource && fs.existsSync(p)) {
            try { fs.unlinkSync(p); } catch (e) {}
        }
    });

    if (updatedSnapshots.length > 0) {
        const remainingRows = [];
        updatedSnapshots.forEach(snap => {
            if (snap.rows && Array.isArray(snap.rows)) {
                remainingRows.push(...snap.rows);
            }
        });
        const rebuilt = mergeScheduleRows([], remainingRows);
        latestScheduleData = rebuilt;
        saveScheduleData(rebuilt);
    } else {
        latestScheduleData = latestScheduleData.filter(r => r.source !== removedSnapshot.source);
        saveScheduleData(latestScheduleData);
    }

    return res.json({
        success: true,
        message: "Snapshot and associated data deleted successfully.",
        remainingSnapshots: scheduleSnapshots.length,
        rows: latestScheduleData,
        summary: getDashboardSummary(latestScheduleData)
    });
});

app.post("/upload-excel", upload.single("excelFile"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({
            message: "No Excel file uploaded."
        });
    }

    const uploadedPath = req.file.path;

    try {
        const workbook = XLSX.readFile(uploadedPath);
        const rows = parseScheduleWorkbook(workbook);

        if (!rows.length) {
            return res.status(400).json({
                message: "No valid schedule rows found in the uploaded file. Please check the headers and columns."
            });
        }

        const importedAt = new Date().toISOString();
        const requestedSnapshotDate = String(req.body.snapshotDate || "").trim();
        if (requestedSnapshotDate && !isValidDateOnly(requestedSnapshotDate)) {
            return res.status(400).json({ message: "Snapshot date must be a valid calendar date." });
        }
        const snapshotDate = requestedSnapshotDate || importedAt.slice(0, 10);
        const importedRows = rows.map(row => ({
            ...row,
            deliveryMonth: row.deliveryMonth || "No month supplied",
            importedAt,
            scheduleReceivedDate: row.scheduleReceivedDate || importedAt.slice(0, 10),
            referenceMonth: new Date(importedAt).toISOString().slice(0, 7),
            source: req.file.originalname
        }));
        const snapshotId = `${importedAt.replace(/[:.]/g, "-")}-${scheduleSnapshots.length + 1}`;
        const snapshot = {
            snapshotId,
            snapshotDate,
            capturedAt: importedAt,
            source: req.file.originalname,
            rows: importedRows
        };

        const safeOriginalName = path.basename(req.file.originalname);
        const storedCopyPath = path.join(uploadDir, `${snapshotId}-${safeOriginalName}`);
        try {
            fs.copyFileSync(uploadedPath, storedCopyPath);
        } catch (copyErr) {
            console.warn("Could not preserve file copy in upload directory:", copyErr.message);
        }

        let dbSaved = false;
        let dbWarning = null;

        if (pool) {
            try {
                await saveScheduleRowsToOracle(importedRows);
                dbSaved = true;
            } catch (dbError) {
                dbWarning = dbError.message;
                console.error("Database save failed:", dbWarning);
            }
        }

        const updatedRows = mergeScheduleRows(latestScheduleData, importedRows);
        saveScheduleSnapshot(snapshot);
        saveScheduleData(updatedRows);
        latestScheduleData = updatedRows;
        const summary = getDashboardSummary(updatedRows);

        return res.json({
            message: dbSaved
                ? "Excel file uploaded and schedule data processed successfully."
                : "Excel file uploaded successfully. Local processing completed; Oracle DB save is not available.",
            filename: req.file.originalname,
            snapshotId,
            snapshotDate,
            summary,
            rows: updatedRows,
            database: dbSaved ? "saved to Oracle" : "local only",
            dbWarning
        });
    } catch (error) {
        console.error(error);
        return res.status(400).json({
            message: "Unable to process the Excel file. Please upload a valid XLSX or XLS file.",
            error: error.message
        });
    } finally {
        if (fs.existsSync(uploadedPath)) {
            fs.unlinkSync(uploadedPath);
        }
    }
});

app.use((error, req, res, next) => {
    if (req.path !== "/upload-excel") {
        return next(error);
    }

    console.error("Spreadsheet upload request failed:", error.message);
    const message = error instanceof multer.MulterError
        ? error.code === "LIMIT_FILE_SIZE"
            ? "The spreadsheet is too large to upload."
            : `The upload could not be accepted (${error.message}). Please try selecting the file again.`
        : error.message || "Unable to receive the spreadsheet.";
    return res.status(400).json({ message });
});

function refreshExistingSnapshots() {
    let changed = false;
    for (const snap of scheduleSnapshots) {
        const hasMonths = (snap.rows || []).some(r => r.monthlySchedules && Object.keys(r.monthlySchedules).length > 0);
        if (!hasMonths) {
            const safeSource = path.basename(snap.source || "");
            const candidates = [
                path.join(uploadDir, `${snap.snapshotId}-${safeSource}`),
                path.join(uploadDir, safeSource)
            ];
            for (const p of candidates) {
                if (fs.existsSync(p)) {
                    try {
                        const wb = XLSX.readFile(p);
                        const parsed = parseScheduleWorkbook(wb);
                        if (parsed.length > 0) {
                            snap.rows = parsed;
                            changed = true;
                            console.log(`Re-parsed ${snap.source} with enhanced parser: ${parsed.length} rows found.`);
                        }
                    } catch (e) {
                        console.warn(`Could not re-parse ${p}:`, e.message);
                    }
                    break;
                }
            }
        }
    }

    const octPlanPath = path.join(uploadDir, "Motor_Monthly_Plan_Oct26_Rev-01.xlsx");
    if (fs.existsSync(octPlanPath) && !scheduleSnapshots.some(s => s.source?.includes("Oct26_Rev-01"))) {
        try {
            const wb = XLSX.readFile(octPlanPath);
            const parsed = parseScheduleWorkbook(wb);
            if (parsed.length > 0) {
                const snap = {
                    snapshotId: `oct26-rev1-${Date.now()}`,
                    snapshotDate: "2026-10-05",
                    capturedAt: new Date().toISOString(),
                    source: "Motor_Monthly_Plan_Oct26_Rev-01.xlsx",
                    rows: parsed
                };
                scheduleSnapshots.push(snap);
                changed = true;
                console.log(`Auto-registered ${snap.source}: ${parsed.length} rows.`);
            }
        } catch (e) {}
    }

    const sepPlanPath = path.join(uploadDir, "Motor_Monthly_Plan_Sep26.xlsx");
    if (fs.existsSync(sepPlanPath) && !scheduleSnapshots.some(s => s.source?.includes("Sep26"))) {
        try {
            const wb = XLSX.readFile(sepPlanPath);
            const parsed = parseScheduleWorkbook(wb);
            if (parsed.length > 0) {
                const snap = {
                    snapshotId: `sep26-${Date.now()}`,
                    snapshotDate: "2026-09-05",
                    capturedAt: new Date().toISOString(),
                    source: "Motor_Monthly_Plan_Sep26.xlsx",
                    rows: parsed
                };
                scheduleSnapshots.push(snap);
                changed = true;
                console.log(`Auto-registered ${snap.source}: ${parsed.length} rows.`);
            }
        } catch (e) {}
    }

    if (changed) {
        saveScheduleSnapshotData(scheduleSnapshots);
        const allRows = scheduleSnapshots.flatMap(s => s.rows || []);
        latestScheduleData = mergeScheduleRows([], allRows);
        saveScheduleData(latestScheduleData);
    }
}

async function startServer() {
    latestScheduleData = loadScheduleData();
    console.log(`Loaded ${latestScheduleData.length} saved schedule records.`);
    scheduleSnapshots = loadScheduleSnapshots();
    console.log(`Loaded ${scheduleSnapshots.length} historical schedule snapshots.`);
    refreshExistingSnapshots();
    await initializeDatabase();
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

startServer();
