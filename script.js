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

// Система умных обновлений
let updateTimer = null;
let nextUpdateTime = null;

// Российские праздники 2024-2025 (основные)
const RUSSIAN_HOLIDAYS = new Set([
    '2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05', 
    '2024-01-08', '2024-02-23', '2024-03-08', '2024-05-01', '2024-05-09',
    '2024-06-12', '2024-11-04', '2024-12-31',
    '2025-01-01', '2025-01-02', '2025-01-03', '2025-01-08', '2025-02-23',
    '2025-03-08', '2025-05-01', '2025-05-09', '2025-06-12', '2025-11-04',
    '2025-12-31'
]);

const SmartUpdateManager = {
    // Проверка рабочего дня
    isWorkingDay(date = new Date()) {
        const dayOfWeek = date.getDay();
        const dateString = date.toISOString().split('T')[0];
        
        // Выходные дни (суббота = 6, воскресенье = 0)
        if (dayOfWeek === 0 || dayOfWeek === 6) return false;
        
        // Российские праздники
        if (RUSSIAN_HOLIDAYS.has(dateString)) return false;
        
        return true;
    },

    // Получение оптимального интервала обновления
    getUpdateInterval(date = new Date()) {
        const hour = date.getHours();
        const isWorking = this.isWorkingDay(date);
        
        if (!isWorking) {
            // Выходные и праздники - обновления редко
            return 6 * 60 * 60 * 1000; // 6 часов
        }
        
        // Рабочие дни
        if (hour >= 12 && hour <= 15) {
            // Время обновления ЦБ РФ (13:00) - частые обновления
            return 15 * 60 * 1000; // 15 минут
        } else if (hour >= 8 && hour <= 18) {
            // Рабочие часы - умеренные обновления
            return 60 * 60 * 1000; // 1 час
        } else if (hour >= 0 && hour <= 7) {
            // Ночь - редкие обновления
            return 4 * 60 * 60 * 1000; // 4 часа
        } else {
            // Вечер - умеренные обновления
            return 2 * 60 * 60 * 1000; // 2 часа
        }
    },

    // Получение времени следующего обновления ЦБ РФ
    getNextCBRUpdateTime(date = new Date()) {
        const moscowTime = new Date(date.toLocaleString("en-US", {timeZone: "Europe/Moscow"}));
        const currentHour = moscowTime.getHours();
        
        // Если сегодня рабочий день и еще не 15:00
        if (this.isWorkingDay(moscowTime) && currentHour < 15) {
            const today = new Date(moscowTime);
            today.setHours(13, 0, 0, 0); // 13:00 МСК
            return today;
        }
        
        // Иначе ищем следующий рабочий день
        const nextDay = new Date(moscowTime);
        nextDay.setDate(nextDay.getDate() + 1);
        
        while (!this.isWorkingDay(nextDay)) {
            nextDay.setDate(nextDay.getDate() + 1);
        }
        
        nextDay.setHours(13, 0, 0, 0); // 13:00 МСК следующего рабочего дня
        return nextDay;
    },

    // Форматирование времени до следующего обновления
    formatTimeUntilUpdate() {
        if (!nextUpdateTime) return '';
        
        const now = new Date();
        const diff = nextUpdateTime - now;
        
        if (diff <= 0) return 'Обновляется...';
        
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        
        if (hours > 0) {
            return `${hours}ч ${minutes}м`;
        } else {
            return `${minutes}м`;
        }
    },

    // Установка таймера с учетом адаптивного интервала
    scheduleNextUpdate() {
        if (updateTimer) {
            clearTimeout(updateTimer);
        }
        
        const interval = this.getUpdateInterval();
        nextUpdateTime = new Date(Date.now() + interval);
        
        console.log(`Следующее обновление через: ${this.formatTimeUntilUpdate()}`);
        console.log(`Текущее время: ${new Date().toLocaleString()}, Интервал: ${Math.round(interval/1000/60)} мин`);
        
        updateTimer = setTimeout(() => {
            loadAll();
            this.scheduleNextUpdate(); // Планируем следующее обновление
        }, interval);
        
        // Обновляем индикатор
        this.updateNextUpdateIndicator();
    },

    // Обновление индикатора следующего обновления
    updateNextUpdateIndicator() {
        const indicator = document.getElementById('nextUpdateIndicator');
        if (indicator) {
            const timeText = this.formatTimeUntilUpdate();
            const nextCBR = this.getNextCBRUpdateTime();
            const isToday = nextCBR.toDateString() === new Date().toDateString();
            
            indicator.innerHTML = `
                <div class="next-update-info">
                    <div class="next-auto">Автообновление: ${timeText}</div>
                    <div class="next-cbr">ЦБ РФ: ${isToday ? 'сегодня' : 'завтра'} в 13:00</div>
                </div>
            `;
        }
    },

    // Принудительное обновление
    forceUpdate() {
        if (updateTimer) {
            clearTimeout(updateTimer);
        }
        loadAll();
        this.scheduleNextUpdate();
    }
};

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
            
            // Проверяем что получили XML, а не HTML с ошибкой
            if (!text.includes('<?xml') && !text.includes('<ValCurs')) {
                console.warn('Получен не XML ответ:', text.substring(0, 200));
                throw new APIError('Сервер ЦБ РФ вернул некорректный ответ', 'PARSE_ERROR');
            }
            
            const xml = new DOMParser().parseFromString(text, "text/xml");
            
            // Проверяем ошибки парсинга
            const parseError = xml.querySelector('parsererror');
            if (parseError) {
                console.warn('Ошибка парсинга XML:', parseError.textContent);
                throw new APIError('Ошибка парсинга XML данных от ЦБ РФ', 'PARSE_ERROR');
            }
            
            // Проверяем что есть данные о валютах
            const valutes = xml.getElementsByTagName('Valute');
            if (valutes.length === 0) {
                console.warn('XML не содержит данных о валютах:', text.substring(0, 200));
                throw new APIError('XML не содержит данных о курсах валют', 'PARSE_ERROR');
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
    const updatePanel = document.getElementById('nextUpdateIndicator');
    const now = new Date();
    
    timeSpan.textContent = now.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    indicator.style.display = 'block';
    
    // Показываем состояние обновления
    if (updatePanel) {
        updatePanel.classList.add('updating');
    }
    
    setTimeout(() => {
        indicator.style.display = 'none';
        if (updatePanel) {
            updatePanel.classList.remove('updating');
        }
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
    console.log('Принудительная попытка обновления...');
    retryCount = 0;
    
    // Сбрасываем текущий таймер
    if (updateTimer) {
        clearTimeout(updateTimer);
        updateTimer = null;
    }
    
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
        
        // Перепланируем следующее обновление
        SmartUpdateManager.scheduleNextUpdate();

    } catch (error) {
        console.error("Ошибка загрузки курсов:", error);
        
        // Пытаемся загрузить из кэша при любой ошибке
        if (loadFromCache()) {
            let statusMessage = 'Данные загружены из кэша';
            if (error instanceof APIError) {
                switch (error.code) {
                    case 'PARSE_ERROR':
                        statusMessage += ' (проблема с сервером ЦБ РФ)';
                        break;
                    case 'TIMEOUT':
                        statusMessage += ' (таймаут)';
                        break;
                    default:
                        statusMessage += ' (ошибка сети)';
                }
            }
            ConnectionManager.updateStatus(statusMessage, true);
            
            // Планируем следующее обновление с увеличенным интервалом при ошибке
            setTimeout(() => {
                SmartUpdateManager.scheduleNextUpdate();
            }, 100);
            
            // Увеличиваем retryCount но не блокируем систему
            retryCount++;
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
                    errorMessage = 'Ошибка обработки данных от сервера ЦБ РФ. Попробуйте позже.';
                    // При ошибке парсинга можно повторить позже
                    canRetry = true;
                    break;
                default:
                    errorMessage = `Ошибка сети: ${error.message}`;
            }
        } else {
            errorMessage = `Неожиданная ошибка: ${error.message}`;
        }
        
        showError(errorMessage, canRetry && retryCount < MAX_RETRIES);
        retryCount++;
        
        // Планируем следующую попытку даже при критических ошибках
        // Используем увеличенный интервал
        if (retryCount < MAX_RETRIES) {
            const retryDelay = Math.min(5 * 60 * 1000 * Math.pow(2, retryCount - 1), 30 * 60 * 1000); // От 5 минут до 30 минут
            setTimeout(() => {
                SmartUpdateManager.scheduleNextUpdate();
            }, retryDelay);
        } else {
            // Если превышено количество попыток, планируем через час
            setTimeout(() => {
                retryCount = 0; // Сбрасываем счетчик
                SmartUpdateManager.scheduleNextUpdate();
            }, 60 * 60 * 1000); // 1 час
        }
    }
}

// Очистка ресурсов при закрытии страницы
window.addEventListener('beforeunload', () => {
    ObjectPool.clearFrames();
    if (FlagLoader.observer) {
        FlagLoader.observer.disconnect();
    }
});

// Pull-to-refresh функциональность
const PullToRefresh = {
    startY: 0,
    currentY: 0,
    pulling: false,
    threshold: 80,
    maxPull: 150,
    
    init() {
        const table = document.getElementById('ratesTable');
        if (!table) return;
        
        // Touch события для мобильных
        table.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
        table.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
        table.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });
        
        // Mouse события для десктопа (для тестирования)
        table.addEventListener('mousedown', this.handleMouseStart.bind(this));
        table.addEventListener('mousemove', this.handleMouseMove.bind(this));
        table.addEventListener('mouseup', this.handleMouseEnd.bind(this));
        table.addEventListener('mouseleave', this.handleMouseEnd.bind(this));
    },
    
    handleTouchStart(e) {
        if (window.scrollY > 0) return;
        this.startY = e.touches[0].clientY;
        this.pulling = true;
    },
    
    handleTouchMove(e) {
        if (!this.pulling || window.scrollY > 0) return;
        
        this.currentY = e.touches[0].clientY;
        const pullDistance = Math.max(0, this.currentY - this.startY);
        
        if (pullDistance > 0) {
            e.preventDefault();
            this.updatePullIndicator(pullDistance);
        }
    },
    
    handleTouchEnd(e) {
        if (!this.pulling) return;
        
        const pullDistance = this.currentY - this.startY;
        
        if (pullDistance > this.threshold) {
            this.triggerRefresh();
        } else {
            this.resetPull();
        }
        
        this.pulling = false;
    },
    
    handleMouseStart(e) {
        if (window.scrollY > 0) return;
        this.startY = e.clientY;
        this.pulling = true;
    },
    
    handleMouseMove(e) {
        if (!this.pulling || window.scrollY > 0) return;
        
        this.currentY = e.clientY;
        const pullDistance = Math.max(0, this.currentY - this.startY);
        
        if (pullDistance > 0) {
            e.preventDefault();
            this.updatePullIndicator(pullDistance);
        }
    },
    
    handleMouseEnd(e) {
        if (!this.pulling) return;
        
        const pullDistance = this.currentY - this.startY;
        
        if (pullDistance > this.threshold) {
            this.triggerRefresh();
        } else {
            this.resetPull();
        }
        
        this.pulling = false;
    },
    
    updatePullIndicator(distance) {
        const limitedDistance = Math.min(distance, this.maxPull);
        const progress = Math.min(distance / this.threshold, 1);
        
        let indicator = document.getElementById('pullRefreshIndicator');
        if (!indicator) {
            indicator = this.createPullIndicator();
        }
        
        const rotation = progress * 180;
        const opacity = Math.min(progress, 1);
        const scale = 0.5 + (progress * 0.5);
        
        indicator.style.transform = `translateY(${limitedDistance - 60}px) scale(${scale})`;
        indicator.style.opacity = opacity;
        indicator.querySelector('.pull-arrow').style.transform = `rotate(${rotation}deg)`;
        
        // Изменяем текст в зависимости от прогресса
        const text = indicator.querySelector('.pull-text');
        if (progress >= 1) {
            text.textContent = 'Отпустите для обновления';
            indicator.classList.add('ready');
        } else {
            text.textContent = 'Потяните для обновления';
            indicator.classList.remove('ready');
        }
    },
    
    createPullIndicator() {
        const indicator = document.createElement('div');
        indicator.id = 'pullRefreshIndicator';
        indicator.className = 'pull-refresh-indicator';
        indicator.innerHTML = `
            <div class="pull-content">
                <div class="pull-arrow">↓</div>
                <div class="pull-text">Потяните для обновления</div>
            </div>
        `;
        
        document.body.appendChild(indicator);
        return indicator;
    },
    
    triggerRefresh() {
        const indicator = document.getElementById('pullRefreshIndicator');
        if (indicator) {
            indicator.classList.add('refreshing');
            indicator.querySelector('.pull-text').textContent = 'Обновление...';
            indicator.querySelector('.pull-arrow').style.transform = 'rotate(360deg)';
        }
        
        // Принудительное обновление
        SmartUpdateManager.forceUpdate();
        
        // Сброс через 2 секунды
        setTimeout(() => {
            this.resetPull();
        }, 2000);
    },
    
    resetPull() {
        const indicator = document.getElementById('pullRefreshIndicator');
        if (indicator) {
            indicator.style.transform = 'translateY(-60px) scale(0.5)';
            indicator.style.opacity = '0';
            indicator.classList.remove('ready', 'refreshing');
            
            setTimeout(() => {
                if (indicator.parentNode) {
                    indicator.parentNode.removeChild(indicator);
                }
            }, 300);
        }
    }
};

// Инициализация приложения с оптимизацией
document.addEventListener('DOMContentLoaded', () => {
    ConnectionManager.init();
    FlagLoader.init();
    PullToRefresh.init();
    loadAll();
    
    // Запускаем умную систему обновлений
    SmartUpdateManager.scheduleNextUpdate();
    
    // Обновляем индикатор каждую минуту
    setInterval(() => {
        SmartUpdateManager.updateNextUpdateIndicator();
    }, 60000);
    
    // Полноэкранный режим по клику (один раз)
    document.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    }, { once: true, passive: true });
});

// Экспортируем функции для глобального доступа
window.retryLoad = retryLoad;
window.forceUpdate = () => SmartUpdateManager.forceUpdate();