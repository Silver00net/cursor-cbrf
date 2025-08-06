const orderedCodes = ["USD", "EUR", "GBP", "JPY", "CHF", "CNY", "TRY", "HKD", "AED", "INR"];

const flagMap = {
    USD: "us", EUR: "eu", GBP: "gb", JPY: "jp", CHF: "ch", 
    CNY: "cn", TRY: "tr", HKD: "hk", AED: "ae", INR: "in"
};

const currencySymbols = {
    USD: "$", EUR: "€", GBP: "£", JPY: "¥", CHF: "₣", 
    CNY: "¥", TRY: "₺", HKD: "HK$", AED: "د.إ", INR: "₹"
};

// Глобальные переменные
let previousRates = {};
let isFirstLoad = true;
let retryCount = 0;
const MAX_RETRIES = 3;
const CACHE_KEY = 'cbrf_currency_cache';
const CACHE_EXPIRY_KEY = 'cbrf_cache_expiry';
const CACHE_DURATION = 30 * 60 * 1000; // 30 минут

// Пул объектов для переиспользования
const ObjectPool = {
    elements: new WeakMap(),
    animationFrames: new Set(),
    
    getElement(key) {
        return this.elements.get(key);
    },
    
    setElement(key, value) {
        this.elements.set(key, value);
    },
    
    addFrame(id) {
        this.animationFrames.add(id);
    },
    
    removeFrame(id) {
        this.animationFrames.delete(id);
    },
    
    clearFrames() {
        this.animationFrames.forEach(id => cancelAnimationFrame(id));
        this.animationFrames.clear();
    }
};

// Оптимизированный кэш-менеджер
const CacheManager = {
    _cache: new Map(),
    
    set(data) {
        try {
            const serialized = JSON.stringify(data);
            localStorage.setItem(CACHE_KEY, serialized);
            localStorage.setItem(CACHE_EXPIRY_KEY, Date.now() + CACHE_DURATION);
            this._cache.set(CACHE_KEY, data); // В памяти для быстрого доступа
        } catch (e) {
            console.warn('Не удалось сохранить данные в кэш:', e);
        }
    },

    get() {
        try {
            // Сначала проверяем кэш в памяти
            if (this._cache.has(CACHE_KEY)) {
                const expiry = localStorage.getItem(CACHE_EXPIRY_KEY);
                if (expiry && Date.now() <= parseInt(expiry)) {
                    return this._cache.get(CACHE_KEY);
                }
            }
            
            const expiry = localStorage.getItem(CACHE_EXPIRY_KEY);
            if (!expiry || Date.now() > parseInt(expiry)) {
                this.clear();
                return null;
            }
            
            const data = localStorage.getItem(CACHE_KEY);
            if (data) {
                const parsed = JSON.parse(data);
                this._cache.set(CACHE_KEY, parsed);
                return parsed;
            }
            return null;
        } catch (e) {
            console.warn('Ошибка чтения кэша:', e);
            return null;
        }
    },

    clear() {
        try {
            localStorage.removeItem(CACHE_KEY);
            localStorage.removeItem(CACHE_EXPIRY_KEY);
            this._cache.clear();
        } catch (e) {
            console.warn('Ошибка очистки кэша:', e);
        }
    }
};

// Дебаунс функция для оптимизации
const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

// Управление состоянием подключения с оптимизацией
const ConnectionManager = {
    isOnline: navigator.onLine,
    statusElement: null,
    
    init() {
        // Создаем элемент статуса заранее
        this.statusElement = document.createElement('div');
        this.statusElement.id = 'connectionStatus';
        this.statusElement.className = 'connection-status';
        this.statusElement.style.display = 'none';
        document.body.appendChild(this.statusElement);
        
        const handleOnline = debounce(() => {
            this.isOnline = true;
            this.updateStatus('Подключение восстановлено');
            setTimeout(() => this.hideStatus(), 3000);
        }, 300);
        
        const handleOffline = debounce(() => {
            this.isOnline = false;
            this.updateStatus('Работа в офлайн режиме', true);
        }, 300);
        
        window.addEventListener('online', handleOnline, { passive: true });
        window.addEventListener('offline', handleOffline, { passive: true });
    },

    updateStatus(message, isOffline = false) {
        if (!this.statusElement) return;
        
        this.statusElement.textContent = message;
        this.statusElement.className = `connection-status ${isOffline ? 'offline' : ''}`;
        this.statusElement.style.display = 'block';
    },

    hideStatus() {
        if (this.statusElement) {
            this.statusElement.style.display = 'none';
        }
    }
};

// Оптимизированная ленивая загрузка флагов
const FlagLoader = {
    loadedFlags: new Set(),
    observer: null,
    
    init() {
        // Создаем observer один раз
        this.observer = new IntersectionObserver(
            this.handleIntersection.bind(this),
            { threshold: 0.1, rootMargin: '50px' }
        );
    },
    
    handleIntersection(entries) {
        const fragment = document.createDocumentFragment();
        
        for (const entry of entries) {
            if (entry.isIntersecting) {
                const flagCode = entry.target.getAttribute('data-flag');
                this.loadFlag(flagCode, entry.target);
                this.observer.unobserve(entry.target);
            }
        }
    },
    
    loadFlag(flagCode, element) {
        if (this.loadedFlags.has(flagCode)) return;
        
        // Используем requestIdleCallback для неблокирующей загрузки
        const loadCallback = () => {
            element.classList.add('loaded');
            this.loadedFlags.add(flagCode);
        };
        
        if (window.requestIdleCallback) {
            requestIdleCallback(loadCallback);
        } else {
            setTimeout(loadCallback, 0);
        }
    },

    loadVisibleFlags() {
        if (!this.observer) this.init();
        
        const flagElements = document.querySelectorAll('.flag[data-flag]:not(.loaded)');
        flagElements.forEach(flag => this.observer.observe(flag));
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

// Мемоизация для функций форматирования
const memoize = (fn) => {
    const cache = new Map();
    return (...args) => {
        const key = JSON.stringify(args);
        if (cache.has(key)) {
            return cache.get(key);
        }
        const result = fn(...args);
        cache.set(key, result);
        return result;
    };
};

const formatDateCBR = memoize((date) => {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
});

const getLastWorkingDay = memoize((dateString) => {
    const date = new Date(dateString);
    const d = new Date(date);
    let day = d.getDay();
    if (day === 0) d.setDate(d.getDate() - 2); // Sunday -> Friday
    else if (day === 6) d.setDate(d.getDate() - 1); // Saturday -> Friday
    return d;
});

// Оптимизированный fetch с пулом соединений
async function fetchXMLWithRetry(url, retries = MAX_RETRIES) {
    const fetchOptions = {
        headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        },
        keepalive: true // Переиспользование соединения
    };
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const proxyUrl = 'https://kurscbrf.free.nf/New1/proxy.php?url=' + encodeURIComponent(url);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(proxyUrl, {
                ...fetchOptions,
                signal: controller.signal
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
            
            // Экспоненциальная задержка с jitter
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            const jitter = Math.random() * 1000;
            await new Promise(resolve => setTimeout(resolve, delay + jitter));
        }
    }
}

// Оптимизированная анимация с пулом
function animateValue(element, start, end, duration = 1000) {
    // Отменяем предыдущую анимацию если есть
    const existingAnimation = ObjectPool.getElement(element);
    if (existingAnimation) {
        cancelAnimationFrame(existingAnimation);
        ObjectPool.removeFrame(existingAnimation);
    }
    
    const startTimestamp = performance.now();
    element.classList.add('rate-updating');
    
    const step = (timestamp) => {
        let progress = (timestamp - startTimestamp) / duration;
        if (progress > 1) progress = 1;
        
        // Cubic ease-out для более плавной анимации
        const easedProgress = 1 - Math.pow(1 - progress, 3);
        
        const value = start + (end - start) * easedProgress;
        element.textContent = value.toFixed(4).replace('.', ',');
        
        if (progress < 1) {
            const frameId = requestAnimationFrame(step);
            ObjectPool.setElement(element, frameId);
            ObjectPool.addFrame(frameId);
        } else {
            element.classList.remove('rate-updating');
            ObjectPool.setElement(element, null);
        }
    };
    
    const frameId = requestAnimationFrame(step);
    ObjectPool.setElement(element, frameId);
    ObjectPool.addFrame(frameId);
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

// Оптимизированная загрузка из кэша с батчингом DOM операций
function loadFromCache() {
    const cachedData = CacheManager.get();
    if (!cachedData) return false;
    
    try {
        const table = document.getElementById('ratesTable');
        const body = table.querySelector('tbody');
        
        // Используем DocumentFragment для батчинга DOM операций
        const fragment = document.createDocumentFragment();
        
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
            fragment.appendChild(tr);
        });

        // Одна DOM операция вместо множественных
        body.innerHTML = "";
        body.appendChild(fragment);

        document.getElementById("currentDate").textContent = `Дата обновления: ${cachedData.date} (из кэша)`;
        
        // Загружаем флаги асинхронно
        if (window.requestIdleCallback) {
            requestIdleCallback(() => FlagLoader.loadVisibleFlags());
        } else {
            setTimeout(() => FlagLoader.loadVisibleFlags(), 100);
        }
        
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

        const today = getLastWorkingDay(new Date().toISOString());
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayFormatted = getLastWorkingDay(yesterday.toISOString());

        const [xmlToday, xmlYest] = await Promise.all([
            fetchXMLWithRetry(`https://www.cbr.ru/scripts/XML_daily.asp?date_req=${formatDateCBR(today)}`),
            fetchXMLWithRetry(`https://www.cbr.ru/scripts/XML_daily.asp?date_req=${formatDateCBR(yesterdayFormatted)}`)
        ]);

        const ratesData = [];
        const fragment = document.createDocumentFragment();

        // Обрабатываем данные в одном цикле
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
                code, name, rate: rateToday, diff: diffFixed, diffClass
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
                fragment.appendChild(tr);

                // Планируем анимацию на следующий тик
                setTimeout(() => {
                    const prevRate = previousRates[code] ?? 0;
                    animateValue(tdRate, prevRate, rateToday, 1200);
                }, 0);
            } else {
                // Обновляем существующие данные
                const rows = body.querySelectorAll('tr');
                const row = rows[index];
                if (row) {
                    const rateCell = row.querySelector('.rate-cell');
                    const diffCell = row.children[2];
                    
                    const prevRate = previousRates[code] ?? rateToday;
                    animateValue(rateCell, prevRate, rateToday, 800);
                    
                    diffCell.className = diffClass;
                    diffCell.textContent = `${diffFixed}%`;
                }
            }

            previousRates[code] = rateToday;
        });

        // Батчинг DOM операций для первой загрузки
        if (isFirstLoad && fragment.children.length > 0) {
            body.innerHTML = "";
            body.appendChild(fragment);
        }

        // Асинхронное сохранение в кэш
        if (window.requestIdleCallback) {
            requestIdleCallback(() => {
                CacheManager.set({
                    rates: ratesData,
                    date: today.toLocaleDateString("ru-RU", {
                        year: "numeric", month: "long", day: "numeric"
                    }),
                    timestamp: Date.now()
                });
            });
        } else {
            setTimeout(() => {
                CacheManager.set({
                    rates: ratesData,
                    date: today.toLocaleDateString("ru-RU", {
                        year: "numeric", month: "long", day: "numeric"
                    }),
                    timestamp: Date.now()
                });
            }, 0);
        }

        document.getElementById("currentDate").textContent = `Дата обновления: ${today.toLocaleDateString("ru-RU", {
            year: "numeric", month: "long", day: "numeric"
        })}`;

        if (!isFirstLoad) {
            setTimeout(() => {
                table.classList.remove('updating');
            }, 1000);
        }

        // Асинхронная загрузка флагов
        if (isFirstLoad) {
            if (window.requestIdleCallback) {
                requestIdleCallback(() => FlagLoader.loadVisibleFlags());
            } else {
                setTimeout(() => FlagLoader.loadVisibleFlags(), 500);
            }
        }

        isFirstLoad = false;
        retryCount = 0;

    } catch (error) {
        console.error("Ошибка загрузки курсов:", error);
        
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

// Очистка ресурсов при закрытии страницы
window.addEventListener('beforeunload', () => {
    ObjectPool.clearFrames();
    if (FlagLoader.observer) {
        FlagLoader.observer.disconnect();
    }
});

// Инициализация приложения с оптимизацией
document.addEventListener('DOMContentLoaded', () => {
    ConnectionManager.init();
    FlagLoader.init();
    loadAll();
    
    // Обновление каждый час
    setInterval(loadAll, 3600000);
    
    // Полноэкранный режим по клику (один раз)
    document.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    }, { once: true, passive: true });
});

// Экспортируем функции для глобального доступа
window.retryLoad = retryLoad;