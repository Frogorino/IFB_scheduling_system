const CUSTOMER_MASTER_BY_CODE = {
    "100859": { name: "MATS, Pune1", group: "MATS", legalName: "MAHLE ANAND Thermal Systems Private Limited" },
    "100860": { name: "MATS, Pune2", group: "MATS", legalName: "MAHLE ANAND Thermal Systems Private Limited" },
    "100857": { name: "MATS, Noida", group: "MATS", legalName: "MAHLE ANAND Thermal Systems Private Limited" },
    "101294": { name: "MATS, Chennai", group: "MATS", legalName: "MAHLE ANAND Thermal Systems Private Limited" },
    "100851": { name: "TTR, Rudrapur", group: "TTR", legalName: "TATA TOYO RADIATOR LTD." },
    "100845": { name: "TTR, Sanand", group: "TTR", legalName: "TATA TOYO RADIATOR LTD." },
    "101338": { name: "TTR, Pune", group: "TTR", legalName: "TATA TOYO RADIATOR LIMITED" },
    "100837": { name: "TTR, Pune", group: "TTR", legalName: "TATA TOYO RADIATOR LIMITED" },
    "100451": { name: "M&M, Kanhe", group: "M&M", legalName: "MAHINDRA & MAHINDRA LTD." },
    "100848": { name: "M&M, Jaipur", group: "M&M", legalName: "Mahindra & Mahindra Ltd." },
    "100893": { name: "M&M, Bhiwandi", group: "M&M", legalName: "Mahindra & Mahindra Ltd." },
    "100863": { name: "KAL/Singla", group: "KAL/Singla", legalName: "Singla Imp. & Exp." },
    "100864": { name: "Motherson Bergstrom", group: "Motherson", legalName: "MOTHERSON BERGSTROM HVAC SOLUTIONS PVT. LTD." },
    "100842": { name: "Denso", group: "Denso", legalName: "Denso Thermal Systems Pune Pvt Ltd" },
    "100707": { name: "Hanon, Chennai", group: "Hanon", legalName: "HANON AUTOMOTIVE SYSTEMS INDIA PVT" },
    "101839": { name: "Sanden, Pune", group: "Sanden", legalName: "Sanden Vikas (India) Pvt. Ltd" },
    "100855": { name: "Sanden, Palwal", group: "Sanden", legalName: "Sanden Vikas (India) Pvt. Ltd" },
    "100846": { name: "Pranav, Palwal", group: "Pranav", legalName: "Pranav Vikas (India) PVT. Ltd" },
    "101339": { name: "Subros, Manesar", group: "Subros", legalName: "Subros Limited" },
    "100836": { name: "Subros, Pune", group: "Subros", legalName: "Subros Limited" },
    "100850": { name: "Subros, Chennai", group: "Subros", legalName: "Subros Limited" },
    "100854": { name: "Valeo, Chennai", group: "Valeo", legalName: "Valeo India Private Limited" },
    "100059": { name: "TML", group: "TML", legalName: "TATA MOTORS LTD-Pune" },
    "100058": { name: "TVS MOTOR", group: "TVS", legalName: "TVS MOTOR COMPANY LTD" },
    "400270": { name: "SLPL, Chennai", group: "SLPL", legalName: "SLPL" },
    "200061": { name: "AL Dhia Auto", group: "AL Dhia Auto", legalName: "Al Dhia Auto. Spare Parts Tr. LLC" },
    "101569": { name: "PEE AAR", group: "PEE AAR", legalName: "PEE AAR Automotive" },
    "100665": { name: "IFBAPL Door BLR", group: "IFB Automotive", legalName: "IFB AUTOMOTIVE PVT LTD, (DOOR DIV)" },
    "100022": { name: "IFBAPL Door BNL", group: "IFB Automotive", legalName: "IFB AUTOMOTIVE (P) LTD" },
    "100844": { name: "GM Spares", group: "GM Spares", legalName: "GM Spares" }
};

const CUSTOMER_PATTERNS = [
    { pattern: /(?:mats|mahle).*(?:pune\s*1|pune1)/i, name: "MATS, Pune1", group: "MATS", code: "100859" },
    { pattern: /(?:mats|mahle).*(?:pune\s*2|pune2)/i, name: "MATS, Pune2", group: "MATS", code: "100860" },
    { pattern: /^mats$/i, name: "MATS, Pune2", group: "MATS", code: "100860" },
    { pattern: /(?:mats|mahle).*noida/i, name: "MATS, Noida", group: "MATS", code: "100857" },
    { pattern: /(?:mats|mahle).*chennai/i, name: "MATS, Chennai", group: "MATS", code: "101294" },
    { pattern: /ttr.*(?:rudrapur|pantnagar)/i, name: "TTR, Rudrapur", group: "TTR", code: "100851" },
    { pattern: /ttr.*sanand/i, name: "TTR, Sanand", group: "TTR", code: "100845" },
    { pattern: /ttr.*pune/i, name: "TTR, Pune", group: "TTR", code: "101338" },
    { pattern: /m&m.*kanhe/i, name: "M&M, Kanhe", group: "M&M", code: "100451" },
    { pattern: /m&m.*jaipur/i, name: "M&M, Jaipur", group: "M&M", code: "100848" },
    { pattern: /m&m.*b[hi]+wandi/i, name: "M&M, Bhiwandi", group: "M&M", code: "100893" },
    { pattern: /subros.*manesar/i, name: "Subros, Manesar", group: "Subros", code: "101339" },
    { pattern: /subros.*pune/i, name: "Subros, Pune", group: "Subros", code: "100836" },
    { pattern: /subros.*chennai/i, name: "Subros, Chennai", group: "Subros", code: "100850" },
    { pattern: /sanden.*palwal/i, name: "Sanden, Palwal", group: "Sanden", code: "100855" },
    { pattern: /sanden.*pune/i, name: "Sanden, Pune", group: "Sanden", code: "101839" },
    { pattern: /pranav.*palwal/i, name: "Pranav, Palwal", group: "Pranav", code: "100846" },
    { pattern: /valeo.*chennai/i, name: "Valeo, Chennai", group: "Valeo", code: "100854" },
    { pattern: /hanon.*chennai/i, name: "Hanon, Chennai", group: "Hanon", code: "100707" },
    { pattern: /denso/i, name: "Denso", group: "Denso", code: "100842" },
    { pattern: /^tml(?:\s*pune)?$/i, name: "TML", group: "TML", code: "100059" },
    { pattern: /^tvs(?:\s*motor)?$/i, name: "TVS MOTOR", group: "TVS", code: "100058" },
    { pattern: /ifb.*(?:blr|bangalore|door blr)/i, name: "IFBAPL Door BLR", group: "IFB Automotive", code: "100665" },
    { pattern: /ifb.*(?:bnl|binola|door bnl)/i, name: "IFBAPL Door BNL", group: "IFB Automotive", code: "100022" },
    { pattern: /motherson/i, name: "Motherson Bergstrom", group: "Motherson", code: "100864" },
    { pattern: /(?:kal\/)?singla/i, name: "KAL/Singla", group: "KAL/Singla", code: "100863" },
    { pattern: /slpl/i, name: "SLPL, Chennai", group: "SLPL", code: "400270" },
    { pattern: /al\s*dhia/i, name: "AL Dhia Auto", group: "AL Dhia Auto", code: "200061" },
    { pattern: /pee\s*aar/i, name: "PEE AAR", group: "PEE AAR", code: "101569" },
    { pattern: /gm\s*spares/i, name: "GM Spares", group: "GM Spares", code: "100844" }
];

function normalizeCustomer(customer, customerName2 = "", customerCode = "") {
    const rawCustomer = String(customer || "").trim();
    const rawName2 = String(customerName2 || "").trim();
    const rawCode = String(customerCode || "").trim().replace(/\.0$/, "");

    // 1. Try master lookup by code
    if (rawCode && Object.prototype.hasOwnProperty.call(CUSTOMER_MASTER_BY_CODE, rawCode)) {
        const master = CUSTOMER_MASTER_BY_CODE[rawCode];
        return {
            name: master.name,
            group: master.group,
            code: rawCode,
            legalName: rawName2 || master.legalName
        };
    }

    // 2. Try pattern matching against rawCustomer
    for (const rule of CUSTOMER_PATTERNS) {
        if (rule.pattern.test(rawCustomer) || (rawName2 && rule.pattern.test(rawName2))) {
            const master = CUSTOMER_MASTER_BY_CODE[rule.code];
            return {
                name: rule.name,
                group: rule.group,
                code: rawCode || rule.code,
                legalName: rawName2 || (master ? master.legalName : rawCustomer)
            };
        }
    }

    // 3. Fallback: clean up formatting
    let cleanName = rawCustomer || rawName2 || rawCode || "Unknown Customer";
    // Standardize spacing around commas
    cleanName = cleanName.replace(/\s*,\s*/g, ", ").trim();

    return {
        name: cleanName,
        group: cleanName.split(",")[0].trim(),
        code: rawCode,
        legalName: rawName2 || cleanName
    };
}

module.exports = {
    CUSTOMER_MASTER_BY_CODE,
    CUSTOMER_PATTERNS,
    normalizeCustomer
};
