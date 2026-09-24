const TYPES = {
    A: 1,
    CNAME: 5,
    MX: 15,
    TXT: 16,
    AAAA: 28
};


const elements = {
    domain: document.getElementById("domain"),
    status: document.getElementById("status"),

    primaryIp: document.getElementById("primaryIp"),

    ipv4: document.getElementById("ipv4"),
    ipv6: document.getElementById("ipv6"),

    isp: document.getElementById("isp"),
    geo: document.getElementById("geo"),
    cdn: document.getElementById("cdn"),

    cname: document.getElementById("cname"),
    mx: document.getElementById("mx"),
    txt: document.getElementById("txt"),

    history: document.getElementById("history"),

    copyBtn: document.getElementById("copyBtn"),
    refreshBtn: document.getElementById("refreshBtn"),

    clearHistoryBtn:
        document.getElementById("clearHistoryBtn"),

    jsonBtn: document.getElementById("jsonBtn"),
    csvBtn: document.getElementById("csvBtn")
};


let currentResult = null;



document.addEventListener("DOMContentLoaded", () => {

    loadCurrentSite();
    renderHistory();

});


elements.refreshBtn.addEventListener(
    "click",
    loadCurrentSite
);


elements.copyBtn.addEventListener(
    "click",
    copyPrimaryIp
);


elements.clearHistoryBtn.addEventListener(
    "click",
    clearHistory
);


elements.jsonBtn.addEventListener(
    "click",
    exportJSON
);


elements.csvBtn.addEventListener(
    "click",
    exportCSV
);



async function loadCurrentSite() {

    setLoading(true);

    resetUI();

    try {

        const tabs = await browser.tabs.query({
            active: true,
            currentWindow: true
        });


        if (!tabs.length) {
            throw new Error("Активная вкладка не найдена");
        }


        const tab = tabs[0];


        if (!tab.url) {
            throw new Error("Firefox не дал URL вкладки");
        }


        const url = new URL(tab.url);


        if (
            url.protocol !== "http:" &&
            url.protocol !== "https:"
        ) {

            throw new Error(
                "Открой обычный HTTP/HTTPS сайт"
            );

        }


        const host = url.hostname;


        elements.domain.textContent = host;

        setStatus("Запрашиваю DNS...");


        const [
            ipv4,
            ipv6,
            cname,
            mx,
            txt
        ] = await Promise.all([

            dnsQuery(host, "A"),
            dnsQuery(host, "AAAA"),
            dnsQuery(host, "CNAME"),
            dnsQuery(host, "MX"),
            dnsQuery(host, "TXT")

        ]);


        const primaryIp =
            ipv4[0] ||
            ipv6[0] ||
            null;


        let ipInfo = null;


        if (primaryIp) {

            setStatus("Получаю ASN и геолокацию...");

            try {

                ipInfo =
                    await getIpInfo(primaryIp);

            } catch (error) {

                console.error(
                    "IPinfo:",
                    error
                );

            }

        }


        const cdn = detectCDN(
            ipInfo?.org || "",
            cname
        );


        currentResult = {

            domain: host,

            ipv4,
            ipv6,

            primaryIp,

            cname,
            mx,
            txt,

            ipInfo,

            cdn,

            checkedAt:
                new Date().toISOString()

        };


        renderCurrent(currentResult);

        await saveHistory(currentResult);

        await renderHistory();


        setStatus("Готово");

    } catch (error) {

        console.error(error);

        elements.domain.textContent =
            "DNS Peek";

        setStatus(
            error.message || "Ошибка"
        );

    }


    setLoading(false);

}



async function dnsQuery(host, type) {

    const url =
        new URL(
            "https://cloudflare-dns.com/dns-query"
        );


    url.searchParams.set(
        "name",
        host
    );

    url.searchParams.set(
        "type",
        type
    );


    const response =
        await fetch(url, {

            method: "GET",

            headers: {
                "Accept":
                    "application/dns-json"
            }

        });


    if (!response.ok) {

        throw new Error(
            `DNS HTTP ${response.status}`
        );

    }


    const data =
        await response.json();


    /*
        Status 0 = NOERROR.

        Например NXDOMAIN обычно
        вернёт другой DNS status.
    */

    if (data.Status !== 0) {
        return [];
    }


    const answers =
        data.Answer || [];


    return answers

        .filter(
            answer =>
                answer.type === TYPES[type]
        )

        .map(
            answer => answer.data
        );

}



async function getIpInfo(ip) {

    const response =
        await fetch(
            `https://ipinfo.io/${ip}/json`,
            {
                headers: {
                    "Accept":
                        "application/json"
                }
            }
        );


    if (!response.ok) {

        throw new Error(
            `IPinfo HTTP ${response.status}`
        );

    }


    return await response.json();

}



function renderCurrent(data) {

    const {
        ipv4,
        ipv6,
        cname,
        mx,
        txt,
        ipInfo,
        cdn,
        primaryIp
    } = data;


    elements.primaryIp.textContent =
        primaryIp || "NO IP";


    elements.ipv4.innerHTML =
        listToHtml(ipv4);


    elements.ipv6.innerHTML =
        listToHtml(ipv6);


    elements.cname.innerHTML =
        listToHtml(
            cname.map(removeFinalDot)
        );


    elements.mx.innerHTML =
        listToHtml(
            mx.map(formatMX)
        );


    elements.txt.innerHTML =
        listToHtml(
            txt.map(cleanTXT)
        );


    if (ipInfo) {

        elements.isp.textContent =
            ipInfo.org || "Unknown";


        elements.geo.textContent =
            formatGeo(ipInfo);

    } else {

        elements.isp.textContent =
            "Unknown";

        elements.geo.textContent =
            "Unknown";

    }


    elements.cdn.textContent =
        cdn;

}



function listToHtml(values) {

    if (!values || !values.length) {
        return "—";
    }


    return values

        .map(escapeHTML)

        .join("<br>");

}



function formatMX(value) {

    const parts =
        value.split(/\s+/);


    if (parts.length < 2) {
        return removeFinalDot(value);
    }


    const priority =
        parts.shift();


    const server =
        removeFinalDot(
            parts.join(" ")
        );


    return `${priority} → ${server}`;

}



function cleanTXT(value) {

    let result = value.trim();


    /*
        Cloudflare часто возвращает
        TXT как:

        "hello world"

        либо:

        "part1" "part2"
    */

    if (
        result.startsWith('"') &&
        result.endsWith('"')
    ) {

        result =
            result.slice(1, -1);

    }


    result =
        result.replace(
            /"\s+"/g,
            ""
        );


    return result;

}



function removeFinalDot(value) {

    return value.endsWith(".")
        ? value.slice(0, -1)
        : value;

}



function detectCDN(org, cnames) {

    const provider =
        org.toLowerCase();


    const cnameText =
        cnames
            .join(" ")
            .toLowerCase();


    if (
        provider.includes("cloudflare") ||
        cnameText.includes("cloudflare")
    ) {

        return "Cloudflare";

    }


    if (
        provider.includes("fastly") ||
        cnameText.includes("fastly.net") ||
        cnameText.includes("fastlylb.net")
    ) {

        return "Fastly";

    }


    if (
        provider.includes("akamai") ||
        cnameText.includes("akamaiedge.net") ||
        cnameText.includes("edgesuite.net") ||
        cnameText.includes("edgekey.net")
    ) {

        return "Akamai";

    }


    if (
        cnameText.includes("cloudfront.net")
    ) {

        return "Amazon CloudFront";

    }


    if (
        cnameText.includes("azureedge.net") ||
        cnameText.includes("azurefd.net")
    ) {

        return "Microsoft Azure CDN / Front Door";

    }


    if (
        cnameText.includes("cdn77.org")
    ) {

        return "CDN77";

    }


    return "CDN не обнаружен";

}



function formatGeo(info) {

    const parts = [];


    if (info.country) {

        parts.push(
            countryFlag(
                info.country
            )
        );

    }


    if (info.city) {
        parts.push(info.city);
    }


    if (info.region) {
        parts.push(info.region);
    }


    if (info.country) {

        const countryName =
            getCountryName(
                info.country
            );

        parts.push(countryName);

    }


    return parts
        .filter(Boolean)
        .join(" ");

}



function getCountryName(code) {

    try {

        const names =
            new Intl.DisplayNames(
                ["ru"],
                {
                    type: "region"
                }
            );


        return names.of(code);

    } catch {

        return code;

    }

}



function countryFlag(code) {

    if (
        !code ||
        code.length !== 2
    ) {

        return "";

    }


    return String
        .fromCodePoint(
            ...code
                .toUpperCase()
                .split("")
                .map(
                    char =>
                        127397 +
                        char.charCodeAt()
                )
        );

}



async function copyPrimaryIp() {

    if (
        !currentResult ||
        !currentResult.primaryIp
    ) {

        return;

    }


    await navigator.clipboard.writeText(
        currentResult.primaryIp
    );


    const old =
        elements.copyBtn.textContent;


    elements.copyBtn.textContent =
        "COPIED";


    setTimeout(() => {

        elements.copyBtn.textContent =
            old;

    }, 900);

}



async function saveHistory(data) {

    const result =
        await browser.storage.local.get(
            "dnsPeekHistory"
        );


    let history =
        result.dnsPeekHistory || [];


    const signature = [
        ...data.ipv4,
        ...data.ipv6
    ].join(",");


    const newest =
        history[0];


    /*
        Не создаём 50 одинаковых
        записей при нажатии Refresh.
    */

    if (
        newest &&
        newest.domain === data.domain &&
        newest.signature === signature
    ) {

        return;

    }


    history.unshift({

        domain:
            data.domain,

        primaryIp:
            data.primaryIp,

        ipv4:
            data.ipv4,

        ipv6:
            data.ipv6,

        signature,

        isp:
            data.ipInfo?.org || null,

        cdn:
            data.cdn,

        checkedAt:
            data.checkedAt

    });


    history =
        history.slice(0, 30);


    await browser.storage.local.set({

        dnsPeekHistory:
            history

    });

}



async function renderHistory() {

    const result =
        await browser.storage.local.get(
            "dnsPeekHistory"
        );


    const history =
        result.dnsPeekHistory || [];


    if (!history.length) {

        elements.history.innerHTML = `
            <div class="empty">
                История пуста
            </div>
        `;

        return;

    }


    elements.history.innerHTML =
        history
            .slice(0, 6)
            .map(historyItemHTML)
            .join("");

}



function historyItemHTML(item) {

    const date =
        new Date(
            item.checkedAt
        ).toLocaleString();


    return `
        <div class="historyItem">

            <div class="historyDomain">
                ${escapeHTML(item.domain)}
            </div>

            <div class="historyIp">
                ${
                    escapeHTML(
                        item.primaryIp || "NO IP"
                    )
                }
            </div>

            <div class="historyDate">
                ${escapeHTML(date)}
            </div>

        </div>
    `;

}



async function clearHistory() {

    await browser.storage.local.remove(
        "dnsPeekHistory"
    );


    renderHistory();

}



function exportJSON() {

    if (!currentResult) {
        return;
    }


    downloadFile(
        `${safeFileName(currentResult.domain)}.json`,
        JSON.stringify(
            currentResult,
            null,
            2
        ),
        "application/json"
    );

}



function exportCSV() {

    if (!currentResult) {
        return;
    }


    const rows = [

        [
            "domain",
            currentResult.domain
        ],

        [
            "ipv4",
            currentResult.ipv4.join(" | ")
        ],

        [
            "ipv6",
            currentResult.ipv6.join(" | ")
        ],

        [
            "isp",
            currentResult.ipInfo?.org || ""
        ],

        [
            "city",
            currentResult.ipInfo?.city || ""
        ],

        [
            "region",
            currentResult.ipInfo?.region || ""
        ],

        [
            "country",
            currentResult.ipInfo?.country || ""
        ],

        [
            "cdn",
            currentResult.cdn
        ],

        [
            "cname",
            currentResult.cname.join(" | ")
        ],

        [
            "mx",
            currentResult.mx.join(" | ")
        ],

        [
            "txt",
            currentResult.txt.join(" | ")
        ],

        [
            "checked_at",
            currentResult.checkedAt
        ]

    ];


    const csv =
        rows
            .map(
                row =>
                    row
                        .map(csvEscape)
                        .join(",")
            )
            .join("\n");


    downloadFile(
        `${safeFileName(currentResult.domain)}.csv`,
        csv,
        "text/csv"
    );

}



function csvEscape(value) {

    const string =
        String(value ?? "");


    return `"${string.replace(
        /"/g,
        '""'
    )}"`;

}



function downloadFile(
    name,
    data,
    mime
) {

    const blob =
        new Blob(
            [data],
            {
                type: mime
            }
        );


    const url =
        URL.createObjectURL(blob);


    const anchor =
        document.createElement("a");


    anchor.href =
        url;

    anchor.download =
        name;


    anchor.click();


    setTimeout(() => {

        URL.revokeObjectURL(url);

    }, 1000);

}



function safeFileName(value) {

    return value.replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
    );

}



function escapeHTML(value) {

    return String(value)

        .replaceAll(
            "&",
            "&amp;"
        )

        .replaceAll(
            "<",
            "&lt;"
        )

        .replaceAll(
            ">",
            "&gt;"
        )

        .replaceAll(
            '"',
            "&quot;"
        )

        .replaceAll(
            "'",
            "&#039;"
        );

}



function setStatus(text) {

    elements.status.textContent =
        text;

}



function setLoading(value) {

    elements.refreshBtn.disabled =
        value;


    elements.refreshBtn.textContent =
        value
            ? "LOADING..."
            : "REFRESH";

}



function resetUI() {

    elements.primaryIp.textContent = "—";

    elements.ipv4.textContent = "—";
    elements.ipv6.textContent = "—";

    elements.isp.textContent = "—";
    elements.geo.textContent = "—";
    elements.cdn.textContent = "—";

    elements.cname.textContent = "—";
    elements.mx.textContent = "—";
    elements.txt.textContent = "—";

}
