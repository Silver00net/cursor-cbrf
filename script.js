const orderedCodes = ["USD", "EUR", "GBP", "JPY", "CHF", "CNY", "TRY", "HKD", "AED", "INR"];

const flagMap = {
    USD: "us", 
    EUR: "eu", 
    GBP: "gb", 
    JPY: "jp", 
    CHF: "ch", 
    CNY: "cn", 
    TRY: "tr", 
    HKD: "hk", 
    AED: "ae", 
    INR: "in"
};

const currencySymbols = {
    USD: "$", 
    EUR: "€", 
    GBP: "£", 
    JPY: "¥", 
    CHF: "₣", 
    CNY: "¥", 
    TRY: "₺", 
    HKD: "HK$", 
    AED: "د.إ", 
    INR: "₹"
};

// Глобальные переменные
let previousRates = {};
let isFirstLoad = true;
let retryCount = 0;
const MAX_RETRIES = 3;
const CACHE_KEY = 'cbrf_currency_cache';
const CACHE_EXPIRY_KEY = 'cbrf_cache_expiry';
const CACHE_DURATION = 30 * 60 * 1000; // 30 минут

// Утилиты для работы с кэшем
const CacheManager = {
    set(data) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(data));
            localStorage.setItem(CACHE_EXPIRY_KEY, Date.now() + CACHE_DURATION);
        } catch (e) {
            console.warn('Не удалось сохранить данные в кэш:', e);
        }
    },

    get() {
        try {
            const expiry = localStorage.getItem(CACHE_EXPIRY_KEY);
            if (!expiry || Date.now() > parseInt(expiry)) {
                this.clear();
                return null;
            }
            const data = localStorage.getItem(CACHE_KEY);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.warn('Ошибка чтения кэша:', e);
            return null;
        }
    },

    clear() {
        try {
            localStorage.removeItem(CACHE_KEY);
            localStorage.removeItem(CACHE_EXPIRY_KEY);
        } catch (e) {
            console.warn('Ошибка очистки кэша:', e);
        }
    }
};

// Управление состоянием подключения
const ConnectionManager = {
    isOnline: navigator.onLine,
    
    init() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.updateStatus('Подключение восстановлено');
            setTimeout(() => this.hideStatus(), 3000);
        });
        
        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.updateStatus('Работа в офлайн режиме', true);
        });
    },

    updateStatus(message, isOffline = false) {
        const status = document.getElementById('connectionStatus');
        if (!status) {
            const statusEl = document.createElement('div');
            statusEl.id = 'connectionStatus';
            statusEl.className = 'connection-status';
            document.body.appendChild(statusEl);
        }
        
        const statusEl = document.getElementById('connectionStatus');
        statusEl.textContent = message;
        statusEl.className = `connection-status ${isOffline ? 'offline' : ''}`;
        statusEl.style.display = 'block';
    },

    hideStatus() {
        const status = document.getElementById('connectionStatus');
        if (status) {
            status.style.display = 'none';
        }
    }
};

// Ленивая загрузка флагов
const FlagLoader = {
    loadedFlags: new Set(),
    
    async loadFlag(flagCode) {
        if (this.loadedFlags.has(flagCode)) return;
        
        const flagElement = document.querySelector(`[data-flag="${flagCode}"]`);
        if (!flagElement) return;

        try {
            // Предзагрузка изображения флага
            const img = new Image();
            img.onload = () => {
                flagElement.classList.add('loaded');
                this.loadedFlags.add(flagCode);
            };
            img.onerror = () => {
                console.warn(`Не удалось загрузить флаг: ${flagCode}`);
                flagElement.classList.add('loaded'); // Показываем элемент даже при ошибке
            };
            
            // Устанавливаем источник изображения (флаги загружаются через CSS)
            flagElement.classList.add('loaded');
            this.loadedFlags.add(flagCode);
        } catch (e) {
            console.warn(`Ошибка загрузки флага ${flagCode}:`, e);
            flagElement.classList.add('loaded');
        }
    },

    loadVisibleFlags() {
        const flagElements = document.querySelectorAll('.flag[data-flag]');
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const flagCode = entry.target.getAttribute('data-flag');
                    this.loadFlag(flagCode);
                    observer.unobserve(entry.target);
                }
            });
        });

        flagElements.forEach(flag => observer.observe(flag));
    }
};

// Улучшенная обработка ошибок
class APIError extends Error {
    constructor(message, code, retryable = true) {
        super(message);
        this.name = 'APIError';
        this.code = code;
        this.retryable = retryable;
    }
}

function formatDateCBR(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

function getLastWorkingDay(date) {
    const d = new Date(date);
    let day = d.getDay();
    if (day === 0) d.setDate(d.getDate() - 2); // Sunday -> Friday
    else if (day === 6) d.setDate(d.getDate() - 1); // Saturday -> Friday
    return d;
}

async function fetchXMLWithRetry(url, retries = MAX_RETRIES) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const proxyUrl = 'https://kurscbrf.free.nf/New1/proxy.php?url=' + encodeURIComponent(url);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 секунд таймаут
            
            const response = await fetch(proxyUrl, {
                signal: controller.signal,
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new APIError(
                    `HTTP ${response.status}: ${response.statusText}`, 
                    response.status,
                    response.status >= 500 || response.status === 429
                );
            }
            
            const buffer = await response.arrayBuffer();
            const text = new TextDecoder('windows-1251').decode(buffer);
            const xml = new DOMParser().parseFromString(text, "text/xml");
            
            // Проверяем на ошибки парсинга XML
            const parseError = xml.querySelector('parsererror');
            if (parseError) {
                throw new APIError('Ошибка парсинга XML данных', 'PARSE_ERROR');
            }
            
            return xml;
            
        } catch (error) {
            console.warn(`Попытка ${attempt}/${retries} неудачна:`, error.message);
            
            if (error.name === 'AbortError') {
                throw new APIError('Превышено время ожидания запроса', 'TIMEOUT');
            }
            
            if (attempt === retries) {
                throw error;
            }
            
            // Экспоненциальная задержка между попытками
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Функция анимации чисел с оптимизацией
function animateValue(element, start, end, duration = 1000) {
    const startTimestamp = performance.now();
    element.classList.add('rate-updating');
    
    const step = (timestamp) => {
        let progress = (timestamp - startTimestamp) / duration;
        if (progress > 1) progress = 1;
        
        // Используем easing function для более плавной анимации
        const easedProgress = 1 - Math.pow(1 - progress, 3);
        
        const value = start + (end - start) * easedProgress;
        element.textContent = value.toFixed(4).replace('.', ',');
        
        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            element.classList.remove('rate-updating');
        }
    };
    
    requestAnimationFrame(step);
}

function showUpdateIndicator() {
    const indicator = document.getElementById('lastUpdated');
    const timeSpan = document.getElementById('updateTime');
    const now = new Date();
    
    timeSpan.textContent = now.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    indicator.style.display = 'block';
    
    setTimeout(() => {
        indicator.style.display = 'none';
    }, 3000);
}

function showError(message, canRetry = true) {
    const body = document.querySelector("#ratesTable tbody");
    const errorHtml = `
        <tr>
            <td colspan="3" class="error-message">
                <div>${message}</div>
                ${canRetry ? '<button class="retry-button" onclick="retryLoad()">Повторить попытку</button>' : ''}
            </td>
        </tr>
    `;
    body.innerHTML = errorHtml;
}

function retryLoad() {
    retryCount = 0;
    loadAll();
}

function loadFromCache() {
    const cachedData = CacheManager.get();
    if (!cachedData) return false;
    
    try {
        const table = document.getElementById('ratesTable');
        const body = table.querySelector('tbody');
        
        body.innerHTML = "";
        
        cachedData.rates.forEach((rate, index) => {
            const tr = document.createElement("tr");
            tr.style.animationDelay = `${index * 0.1}s`;

            const tdName = document.createElement("td");
            const symbol = currencySymbols[rate.code] || '';
            tdName.innerHTML = `<span class="flag fi fi-${flagMap[rate.code]}" data-flag="${flagMap[rate.code]}"></span><span class="currency-symbol">${symbol}</span>${rate.code} — ${rate.name}`;

            const tdRate = document.createElement("td");
            tdRate.className = "rate-cell";
            tdRate.textContent = rate.rate.toFixed(4).replace('.', ',');

            const tdDiff = document.createElement("td");
            tdDiff.className = rate.diffClass;
            tdDiff.textContent = `${rate.diff}%`;

            tr.appendChild(tdName);
            tr.appendChild(tdRate);
            tr.appendChild(tdDiff);
            body.appendChild(tr);
        });

        document.getElementById("currentDate").textContent = `Дата обновления: ${cachedData.date} (из кэша)`;
        
        // Загружаем флаги после отрисовки
        setTimeout(() => FlagLoader.loadVisibleFlags(), 100);
        
        return true;
    } catch (e) {
        console.error('Ошибка загрузки из кэша:', e);
        return false;
    }
}

async function loadAll() {
    try {
        const table = document.getElementById('ratesTable');
        const body = table.querySelector('tbody');
        
        if (!isFirstLoad) {
            table.classList.add('updating');
            showUpdateIndicator();
        }
        
        if (isFirstLoad) {
            body.innerHTML = '<tr><td colspan="3" class="loading">Загрузка данных</td></tr>';
        }

        // Проверяем подключение
        if (!ConnectionManager.isOnline) {
            if (loadFromCache()) {
                ConnectionManager.updateStatus('Данные загружены из кэша', true);
                return;
            } else {
                throw new APIError('Нет подключения к интернету и нет кэшированных данных', 'OFFLINE', false);
            }
        }

        let today = getLastWorkingDay(new Date());
        let yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday = getLastWorkingDay(yesterday);

        const [xmlToday, xmlYest] = await Promise.all([
            fetchXMLWithRetry(`https://www.cbr.ru/scripts/XML_daily.asp?date_req=${formatDateCBR(today)}`),
            fetchXMLWithRetry(`https://www.cbr.ru/scripts/XML_daily.asp?date_req=${formatDateCBR(yesterday)}`)
        ]);

        if (isFirstLoad) {
            body.innerHTML = "";
        }

        const ratesData = [];

        orderedCodes.forEach((code, index) => {
            const vToday = Array.from(xmlToday.getElementsByTagName("Valute"))
                .find(v => v.querySelector("CharCode").textContent === code);
            const vYest = Array.from(xmlYest.getElementsByTagName("Valute"))
                .find(v => v.querySelector("CharCode").textContent === code);

            if (!vToday || !vYest) return;

            const name = vToday.querySelector("Name").textContent;
            const rateToday = parseFloat(vToday.querySelector("Value").textContent.replace(",", ".")) /
                            parseInt(vToday.querySelector("Nominal").textContent, 10);
            const rateYest = parseFloat(vYest.querySelector("Value").textContent.replace(",", ".")) /
                           parseInt(vYest.querySelector("Nominal").textContent, 10);

            const diff = ((rateToday - rateYest) / rateYest) * 100;
            const diffFixed = diff.toFixed(2);
            const diffClass = diff >= 0 ? "diff-positive" : "diff-negative";

            ratesData.push({
                code,
                name,
                rate: rateToday,
                diff: diffFixed,
                diffClass
            });

            if (isFirstLoad) {
                const tr = document.createElement("tr");
                tr.style.animationDelay = `${index * 0.1}s`;

                const tdName = document.createElement("td");
                const symbol = currencySymbols[code] || '';
                tdName.innerHTML = `<span class="flag fi fi-${flagMap[code]}" data-flag="${flagMap[code]}"></span><span class="currency-symbol">${symbol}</span>${code} — ${name}`;

                const tdRate = document.createElement("td");
                tdRate.className = "rate-cell";
                tdRate.textContent = "0,0000";

                const tdDiff = document.createElement("td");
                tdDiff.className = diffClass;
                tdDiff.textContent = `${diffFixed}%`;

                tr.appendChild(tdName);
                tr.appendChild(tdRate);
                tr.appendChild(tdDiff);
                body.appendChild(tr);

                // Анимируем изменение значения курса
                const prevRate = previousRates[code] ?? 0;
                animateValue(tdRate, prevRate, rateToday, 1200);
            } else {
                // Обновляем существующие данные
                const rows = body.querySelectorAll('tr');
                const row = rows[index];
                if (row) {
                    const rateCell = row.querySelector('.rate-cell');
                    const diffCell = row.children[2];
                    
                    // Анимируем изменение курса
                    const prevRate = previousRates[code] ?? rateToday;
                    animateValue(rateCell, prevRate, rateToday, 800);
                    
                    // Обновляем разность
                    diffCell.className = diffClass;
                    diffCell.textContent = `${diffFixed}%`;
                }
            }

            previousRates[code] = rateToday;
        });

        // Сохраняем данные в кэш
        CacheManager.set({
            rates: ratesData,
            date: today.toLocaleDateString("ru-RU", {
                year: "numeric", 
                month: "long", 
                day: "numeric"
            }),
            timestamp: Date.now()
        });

        document.getElementById("currentDate").textContent = `Дата обновления: ${today.toLocaleDateString("ru-RU", {
            year: "numeric", 
            month: "long", 
            day: "numeric"
        })}`;

        if (!isFirstLoad) {
            setTimeout(() => {
                table.classList.remove('updating');
            }, 1000);
        }

        // Загружаем флаги после отрисовки
        if (isFirstLoad) {
            setTimeout(() => FlagLoader.loadVisibleFlags(), 500);
        }

        isFirstLoad = false;
        retryCount = 0;

    } catch (error) {
        console.error("Ошибка загрузки курсов:", error);
        
        // Пытаемся загрузить из кэша при ошибке
        if (error instanceof APIError && loadFromCache()) {
            ConnectionManager.updateStatus('Данные загружены из кэша из-за ошибки сети', true);
            return;
        }
        
        let errorMessage = 'Ошибка загрузки данных';
        let canRetry = true;
        
        if (error instanceof APIError) {
            switch (error.code) {
                case 'TIMEOUT':
                    errorMessage = 'Превышено время ожидания. Проверьте подключение к интернету.';
                    break;
                case 'OFFLINE':
                    errorMessage = error.message;
                    canRetry = false;
                    break;
                case 'PARSE_ERROR':
                    errorMessage = 'Ошибка обработки данных от сервера ЦБ РФ';
                    break;
                default:
                    errorMessage = `Ошибка сети: ${error.message}`;
            }
        } else {
            errorMessage = `Неожиданная ошибка: ${error.message}`;
        }
        
        showError(errorMessage, canRetry && retryCount < MAX_RETRIES);
        retryCount++;
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    ConnectionManager.init();
    loadAll();
    
    // Обновление каждый час
    setInterval(loadAll, 3600000);
    
    // Полноэкранный режим по клику
    document.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    }, { once: true });
});

// Экспортируем функции для глобального доступа
window.retryLoad = retryLoad;