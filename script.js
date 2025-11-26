// 全域錯誤攔截 (用於除錯)
window.onerror = function (msg, url, lineNo, columnNo, error) {
    alert('系統錯誤: ' + msg + '\nLine: ' + lineNo);
    return false;
};

/**
 * Police Locate Helper v50.0 (Official Release)
 * Encapsulated logic for security and performance.
 */
const app = (function () {
    // 私有變數
    let map, marker, sector;
    // 新增 reqTime, regTime 欄位
    let data = { lat: null, lng: null, azi: null, phone: '', reqTime: '', regTime: '' };
    let history = [];
    const STORAGE_KEY = 'police_locate_v50_db';

    // 初始化
    function init() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) history = JSON.parse(saved);
            renderHistory();

            // 監聽輸入框變更，即時更新地圖但不存歷史
            // 加入 reqTime, regTime 監聽
            ['lat', 'lng', 'phone', 'azi', 'reqTime', 'regTime'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('change', () => updateFromInput(false));
            });
        } catch (e) {
            console.error('Init error:', e);
        }
    }

    // 核心解析邏輯
    function parse() {
        const text = document.getElementById('rawInput').value;
        if (!text) return alert('請先貼上內容！');

        // 1. 抓門號 (09xx 或 8869xx)
        const phMatch = text.match(/(?:[^0-9\.]|^)(09\d{8}|8869\d{8})(?:[^0-9\.]|$)/);
        if (phMatch) {
            let ph = phMatch[1];
            if (ph.startsWith('886')) ph = '0' + ph.substring(3);
            data.phone = ph;
        }

        // 2. 抓時間 (定位請求 & 註冊基地台)
        // 格式：yyyy/MM/dd HH:mm:ss
        // 使用字串拼接 RegExp 時，需要雙重跳脫字元
        const timePattern = "(\\d{4}\\/\\d{1,2}\\/\\d{1,2}\\s+\\d{1,2}:\\d{1,2}:\\d{1,2})";

        // 定位請求時間
        const reqMatch = text.match(new RegExp(`(?:定位請求|Positioning Request)[^:：\\d]*[:：]?\\s*${timePattern}`));
        data.reqTime = reqMatch ? reqMatch[1] : '';

        // 註冊基地台時間
        const regMatch = text.match(new RegExp(`(?:註冊基地|Base Station Reg)[^:：\\d]*[:：]?\\s*${timePattern}`));
        data.regTime = regMatch ? regMatch[1] : '';

        // 3. 抓方位角
        const azMatch = text.match(/(?:方位|Dir|Azimuth)[^0-9\n]*([0-9]+(?:\.[0-9]+)?)/i);
        data.azi = azMatch ? parseFloat(azMatch[1]) : null;

        // 4. 抓座標 (優化版：優先匹配成對座標)
        // 台灣範圍：Lat 21-27, Lng 118-124
        const latPattern = /2[1-7]\.[0-9]+/;
        const lngPattern = /1(?:1[8-9]|2[0-4])\.[0-9]+/;

        // 嘗試抓取成對的座標 (Lat, Lng 或 Lng, Lat)，中間允許逗號或空白
        const pairMatch = text.match(/(2[1-7]\.[0-9]+)[^0-9\.]+(1(?:1[8-9]|2[0-4])\.[0-9]+)/) ||
            text.match(/(1(?:1[8-9]|2[0-4])\.[0-9]+)[^0-9\.]+(2[1-7]\.[0-9]+)/);

        if (pairMatch) {
            // 判斷哪個是 Lat 哪個是 Lng
            const v1 = parseFloat(pairMatch[1]);
            const v2 = parseFloat(pairMatch[2]);
            if (v1 < 100) { data.lat = v1; data.lng = v2; }
            else { data.lng = v1; data.lat = v2; }
        } else {
            // 備用方案：個別搜尋 (較寬鬆，但仍需符合台灣範圍)
            const allNums = text.match(/[0-9]+\.[0-9]+/g);
            if (allNums) {
                for (let n of allNums) {
                    if (latPattern.test(n)) data.lat = parseFloat(n);
                    if (lngPattern.test(n)) data.lng = parseFloat(n);
                }
            }
        }

        if (data.lat && data.lng) {
            syncUI();
            updateMap(true); // true = 存入歷史
        } else {
            alert('找不到有效的台灣座標數值，請確認內容。');
        }
    }

    // 從輸入框更新資料
    function updateFromInput(save = false) {
        const lat = parseFloat(document.getElementById('lat').value);
        const lng = parseFloat(document.getElementById('lng').value);
        const az = parseFloat(document.getElementById('azi').value);
        const ph = document.getElementById('phone').value;
        const req = document.getElementById('reqTime').value;
        const reg = document.getElementById('regTime').value;

        if (!isNaN(lat) && !isNaN(lng)) {
            data = { lat, lng, azi: isNaN(az) ? null : az, phone: ph, reqTime: req, regTime: reg };
            updateMap(save);
        }
    }

    // 更新 UI 顯示
    function syncUI() {
        document.getElementById('lat').value = data.lat;
        document.getElementById('lng').value = data.lng;
        document.getElementById('azi').value = data.azi !== null ? data.azi : '';
        document.getElementById('phone').value = data.phone;
        document.getElementById('reqTime').value = data.reqTime;
        document.getElementById('regTime').value = data.regTime;
    }

    // 更新地圖與歷史
    function updateMap(save) {
        const mapDiv = document.getElementById('map');
        mapDiv.style.display = 'block';

        if (!map) {
            map = L.map('map').setView([data.lat, data.lng], 16);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OSM'
            }).addTo(map);
        } else {
            map.setView([data.lat, data.lng], 16);
            map.invalidateSize();
        }

        if (marker) map.removeLayer(marker);
        if (sector) map.removeLayer(sector);

        // 地圖 Popup 顯示內容
        let desc = `<b>📍 定位點</b><br>${data.lat}, ${data.lng}`;
        if (data.phone) desc += `<br>📞 ${data.phone}`;
        if (data.reqTime) desc += `<br>🕒 請求: ${data.reqTime}`;
        if (data.regTime) desc += `<br>📡 註冊: ${data.regTime}`;
        if (data.azi !== null) desc += `<br>🧭 方位: ${data.azi}°`;

        marker = L.marker([data.lat, data.lng]).addTo(map)
            .bindPopup(desc).openPopup();

        // 繪製扇形 (若有方位角)
        if (data.azi !== null) {
            const r = 300; // 半徑
            const startAngle = (data.azi - 30) * (Math.PI / 180);
            const endAngle = (data.azi + 30) * (Math.PI / 180);
            const points = [[data.lat, data.lng]];

            for (let i = 0; i <= 20; i++) {
                const angle = startAngle + (endAngle - startAngle) * (i / 20);
                const dLat = (r / 111320) * Math.cos(angle);
                const dLng = (r / (111320 * Math.cos(data.lat * (Math.PI / 180)))) * Math.sin(angle);
                points.push([data.lat + dLat, data.lng + dLng]);
            }
            points.push([data.lat, data.lng]);

            sector = L.polygon(points, { color: 'red', fillOpacity: 0.1, weight: 1 }).addTo(map);
        }

        if (save) addHistory();
    }

    function openMap() {
        if (data.lat) window.open(`https://www.google.com/maps?q=${data.lat},${data.lng}`, '_blank');
        else alert('無座標');
    }

    // 取得完整分享文字 (符合使用者要求格式)
    function getFullText() {
        const mapUrl = `https://www.google.com/maps?q=${data.lat},${data.lng}`;
        let t = `${mapUrl}\n`;
        if (data.phone) t += `門號: ${data.phone}\n`;
        if (data.reqTime) t += `定位時間: ${data.reqTime}\n`;
        if (data.regTime) t += `註冊時間: ${data.regTime}\n`;
        t += `定位經緯度: ${data.lat}, ${data.lng}`;
        if (data.azi) t += ` (方位:${data.azi})`;
        return t;
    }

    function copy() {
        if (!data.lat) return alert('無座標');
        const t = getFullText();

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(t)
                .then(() => alert('✅ 資訊已複製'))
                .catch(err => {
                    console.error(err);
                    fallbackCopy(t);
                });
        } else {
            fallbackCopy(t);
        }
    }

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        alert('✅ 資訊已複製');
    }

    function share(type) {
        if (!data.lat) return alert('無座標');
        const t = getFullText();
        const mapUrl = `https://www.google.com/maps?q=${data.lat},${data.lng}`; // 用於 Telegram 按鈕連結

        let url = '';
        // LINE: 傳送完整文字
        if (type === 'line') {
            url = `https://line.me/R/msg/text/?${encodeURIComponent(t)}`;
        }
        // Telegram: url 參數放地圖連結，text 放完整資訊
        else {
            url = `https://t.me/share/url?url=${encodeURIComponent(mapUrl)}&text=${encodeURIComponent(t)}`;
        }

        // 檢測是否為行動裝置
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        if (isMobile) {
            // 手機版：直接導向，避免開新分頁導致的空白頁問題
            window.location.href = url;
        } else {
            // 電腦版：開新分頁
            window.open(url, '_blank');
        }
    }

    // 新增：貼上功能 (改為 Promise 寫法以增加相容性)
    function pasteInput() {
        if (navigator.clipboard && navigator.clipboard.readText) {
            navigator.clipboard.readText()
                .then(text => {
                    document.getElementById('rawInput').value = text;
                })
                .catch(err => {
                    alert('無法讀取剪貼簿，請手動貼上 (需允許瀏覽器權限)');
                });
        } else {
            alert('您的瀏覽器不支援自動貼上，請長按輸入框手動貼上。');
        }
    }

    // 新增：清空功能
    function clearInput() {
        document.getElementById('rawInput').value = '';
        document.getElementById('rawInput').focus();
    }

    // 歷史紀錄管理
    function addHistory() {
        const now = new Date().toLocaleString('zh-TW', { hour12: false });
        // 避免重複存入完全相同的資料 (座標+電話+時間)
        const isDup = history.some(h =>
            h.lat === data.lat &&
            h.lng === data.lng &&
            h.phone === data.phone &&
            h.reqTime === data.reqTime &&
            h.regTime === data.regTime
        );
        if (isDup) return;

        history.unshift({
            id: Date.now(),
            time: now,
            ...data
        });
        if (history.length > 50) history.pop();
        saveHistory();
    }

    function deleteItem(id, e) {
        e.stopPropagation();
        history = history.filter(x => x.id !== id);
        saveHistory();
    }

    function clearHistory() {
        if (confirm('確定清空紀錄？')) {
            history = []; saveHistory();
        }
    }

    function saveHistory() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
        renderHistory();
    }

    function renderHistory() {
        const ul = document.getElementById('list'); ul.innerHTML = '';
        if (!history.length) {
            ul.innerHTML = '<li style="text-align:center;padding:20px;color:#aaa;">暫無紀錄</li>'; return;
        }

        history.forEach(item => {
            const li = document.createElement('li');
            li.innerHTML = `
                <div style="font-size:0.8rem;color:#999;margin-bottom:4px;">${item.time}</div>
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                    <span style="font-weight:700;color:#2c3e50;font-size:1.05rem;">${item.lat}, ${item.lng}</span>
                    ${item.phone ? `<span class="tag">${item.phone}</span>` : ''}
                </div>
                ${item.reqTime ? `<div style="font-size:0.85rem;color:#555;">🕒 ${item.reqTime}</div>` : ''}
                ${item.azi ? `<div style="font-size:0.85rem;color:#d35400;">🧭 方位: ${item.azi}°</div>` : ''}
                <i class="fa-solid fa-xmark del-icon" onclick="app.deleteItem(${item.id}, event)"></i>
            `;
            li.onclick = () => {
                data = { lat: item.lat, lng: item.lng, azi: item.azi, phone: item.phone, reqTime: item.reqTime, regTime: item.regTime };
                syncUI(); updateMap(false);
            };
            ul.appendChild(li);
        });
    }

    // 公開介面 (Public API)
    return {
        init, // 明確暴露 init
        parse, updateMap, openMap, copy, share,
        clearHistory, deleteItem,
        pasteInput, clearInput // 新增暴露
    };
})();

// 啟動
if (typeof app !== 'undefined') {
    window.onload = app.init;
} else {
    alert('嚴重錯誤：程式初始化失敗，請檢查瀏覽器控制台。');
}
