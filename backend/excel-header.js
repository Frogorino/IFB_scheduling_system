function normalizeHeader(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function extractMonthKey(text) {
    if (!text) return null;
    const normalized = normalizeHeader(text);
    if (/^(?:monthly plan|annual plan|plan|ifb|rev|revision|tentative|firm)\b/.test(normalized)) {
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

function formatMonthLabel(monthKey) {
    if (!monthKey) return "";
    const [y, m] = monthKey.split("-").map(Number);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[m - 1]}-${String(y).slice(-2)}`;
}

function isPrimaryColumn(headerText) {
    const norm = normalizeHeader(headerText);
    return /^(?:sl no|slno|s no|serial|customer|part|part no|helper|line|model|oem|description|application|soldtoparty)/.test(norm);
}

function findScheduleHeaderRow(rows) {
    let bestIndex = -1;
    let bestScore = 0;

    rows.slice(0, 30).forEach((row, index) => {
        const headers = row.map(normalizeHeader).filter(Boolean);
        const hasCustomer = headers.some(header =>
            /^(?:customer|customer name|customer code|customer name2|soldtoparty|sold to party|party name|client|account|buyer)/.test(header)
        );
        const hasPartNumber = headers.some(header =>
            /^(?:part|part no|part number|part no number|material|material no|item code|item|fg part|fg code|part#)/.test(header)
        );
        if (!hasCustomer || !hasPartNumber) return;

        const monthCount = headers.filter(header => extractMonthKey(header)).length;
        const score = 10 + Math.min(monthCount, 5);
        if (score > bestScore) {
            bestIndex = index;
            bestScore = score;
        }
    });

    return bestIndex;
}

function buildCompositeHeaders(sheet, xlsx, headerRowIndex) {
    const rawRows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    const headerRow = rawRows[headerRowIndex] || [];
    const parentRow = headerRowIndex > 0 ? (rawRows[headerRowIndex - 1] || []) : [];

    const merges = sheet["!merges"] || [];
    const parentMap = new Map();

    merges.forEach(m => {
        if (headerRowIndex > 0 && m.s.r === headerRowIndex - 1) {
            const val = parentRow[m.s.c];
            if (val && extractMonthKey(val)) {
                for (let c = m.s.c; c <= m.e.c; c++) {
                    parentMap.set(c, val);
                }
            }
        }
    });

    let lastSeenParent = "";
    for (let c = 0; c < Math.max(headerRow.length, parentRow.length); c++) {
        if (parentMap.has(c)) {
            lastSeenParent = parentMap.get(c);
        } else if (parentRow[c] && extractMonthKey(parentRow[c])) {
            lastSeenParent = parentRow[c];
            parentMap.set(c, lastSeenParent);
        } else if (lastSeenParent && extractMonthKey(lastSeenParent) && !isPrimaryColumn(headerRow[c])) {
            parentMap.set(c, lastSeenParent);
        } else {
            lastSeenParent = "";
        }
    }

    const finalHeaders = [];
    const usedCounts = new Map();

    for (let c = 0; c < headerRow.length; c++) {
        let childHeader = String(headerRow[c] || "").trim();
        let parentHeader = String(parentMap.get(c) || "").trim();
        let composite = childHeader;

        const childMonth = extractMonthKey(childHeader);
        const parentMonth = extractMonthKey(parentHeader);

        if (parentMonth && !isPrimaryColumn(childHeader)) {
            const monthLabel = formatMonthLabel(parentMonth);
            if (!childMonth) {
                composite = `${monthLabel} ${childHeader}`;
            }
        }

        if (!composite) composite = `COL_${c + 1}`;

        if (usedCounts.has(composite)) {
            const count = usedCounts.get(composite) + 1;
            usedCounts.set(composite, count);
            composite = `${composite}_${count}`;
        } else {
            usedCounts.set(composite, 0);
        }

        finalHeaders.push(composite);
    }

    return finalHeaders;
}

function getScheduleRecords(sheet, xlsx) {
    if (!sheet || !sheet["!ref"]) return [];

    const rawRows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    const headerRowIndex = findScheduleHeaderRow(rawRows);
    if (headerRowIndex === -1) return [];

    const headers = buildCompositeHeaders(sheet, xlsx, headerRowIndex);
    const dataRows = rawRows.slice(headerRowIndex + 1);

    const records = [];
    for (const row of dataRows) {
        const firstFew = row.slice(0, 8).map(normalizeHeader).join(" ");
        if (/^(?:total|grand total|sum)\b/.test(firstFew)) continue;

        const record = {};
        let hasAnyValue = false;
        headers.forEach((h, colIdx) => {
            const val = row[colIdx] !== undefined ? String(row[colIdx]).trim() : "";
            if (val !== "") hasAnyValue = true;
            record[h] = val;
        });

        if (hasAnyValue) {
            records.push(record);
        }
    }

    return records;
}

function findBestScheduleSheet(workbook, xlsx) {
    if (!workbook || !workbook.SheetNames || !workbook.SheetNames.length) {
        return { sheetName: "", sheet: null, headerRowIndex: -1 };
    }

    let bestSheetName = workbook.SheetNames[0];
    let bestScore = -1;
    let bestHeaderRowIndex = -1;

    workbook.SheetNames.forEach((sheetName, sIdx) => {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet || !sheet["!ref"]) return;

        const rawRows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
        const headerRowIndex = findScheduleHeaderRow(rawRows);
        if (headerRowIndex !== -1) {
            const headerRow = rawRows[headerRowIndex] || [];
            const parentRow = headerRowIndex > 0 ? (rawRows[headerRowIndex - 1] || []) : [];
            const allHeaderCells = [...parentRow, ...headerRow];
            const monthCount = allHeaderCells.filter(h => extractMonthKey(h)).length;

            let validSampleRows = 0;
            const sampleRows = rawRows.slice(headerRowIndex + 1, headerRowIndex + 6);
            sampleRows.forEach(row => {
                if (row.some(cell => String(cell).trim() !== "")) validSampleRows++;
            });

            let score = 20;
            score += monthCount * 25;
            score += validSampleRows * 5;
            if (sIdx === 0) score += 15;
            if (/plan|schedule|monthly/i.test(sheetName)) score += 10;
            if (/^(?:zsr|summary|sales summary|pivot)/i.test(sheetName)) score -= 30;

            if (score > bestScore) {
                bestScore = score;
                bestSheetName = sheetName;
                bestHeaderRowIndex = headerRowIndex;
            }
        }
    });

    return {
        sheetName: bestSheetName,
        sheet: workbook.Sheets[bestSheetName],
        headerRowIndex: bestHeaderRowIndex
    };
}

module.exports = {
    findScheduleHeaderRow,
    getScheduleRecords,
    buildCompositeHeaders,
    findBestScheduleSheet,
    extractMonthKey,
    formatMonthLabel
};
