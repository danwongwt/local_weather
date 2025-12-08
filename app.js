// OpenWeatherMap API key storage
const STORAGE_KEY = 'owm_api_key';
let API_KEY = '';

// Try to get from localStorage, but handle if blocked
try {
    API_KEY = localStorage.getItem(STORAGE_KEY) || '';
} catch (e) {
    console.warn('localStorage not available:', e);
}

// City codes for Environment Canada
const CITY_CODES = {
    '43.6532,-79.3832': 's0000458',  // Toronto
    '43.8561,-79.3370': 's0000430',  // Markham  
    '43.8828,-79.4403': 's0000623',  // Richmond Hill
    '43.8361,-79.4983': 's0000098'   // Vaughan
};

// Weather icon mapping (Environment Canada codes to emoji)
const WEATHER_ICONS = {
    '00': '☀️', '01': '☀️', '02': '🌤️', '03': '🌤️', '04': '⛅',
    '05': '☁️', '06': '🌦️', '07': '🌦️', '08': '🌧️', '09': '⛈️',
    '10': '🌧️', '11': '🌧️', '12': '🌧️', '13': '🌧️', '14': '🌦️',
    '15': '⛈️', '16': '🌨️', '17': '🌨️', '18': '🌨️', '19': '⛈️',
    '20': '🌦️', '21': '🌧️', '22': '🌨️', '23': '🌨️', '24': '🌨️',
    '25': '🌨️', '26': '❄️', '27': '🌧️', '28': '🌨️', '29': '⛈️',
    '30': '🌤️', '31': '🌤️', '32': '☀️', '33': '🌙', '34': '🌙',
    '35': '☁️', '36': '🌤️', '37': '⛈️', '38': '🌧️', '39': '⛈️',
    '40': '🌨️', '41': '🌨️', '42': '🌨️', '43': '🌨️', '44': '🌧️',
    '45': '🌦️', '46': '⛈️', '47': '🌨️', '48': '🌨️'
};

// Register service worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
        .then(reg => console.log('Service Worker registered'))
        .catch(err => console.log('Service Worker registration failed:', err));
}

// PWA install prompt
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('installPrompt').style.display = 'flex';
});

document.getElementById('installButton').addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        document.getElementById('installPrompt').style.display = 'none';
    }
});

// Location selector
document.getElementById('locationSelect').addEventListener('change', () => {
    fetchWeather();
});

// Main weather fetch function
async function fetchWeather() {
    const coords = document.getElementById('locationSelect').value;
    const [lat, lon] = coords.split(',');
    const cityCode = CITY_CODES[coords];
    
    showLoading();
    
    try {
        // Fetch Environment Canada data
        const ecData = await fetchEnvironmentCanada(cityCode);
        
        // Display EC data (sessions 1-3)
        displayCurrentWeather(ecData);
        displayHourlyForecast(ecData);
        displayDailyForecast(ecData);
        
        // Fetch and display minute precipitation (session 4)
        if (API_KEY) {
            await fetchMinutePrecipitation(lat, lon);
        } else {
            showAPIKeyPrompt();
        }
        
        document.getElementById('lastUpdated').textContent = 
            `Last updated: ${new Date().toLocaleTimeString()}`;
        
        showContent();
    } catch (error) {
        console.error('Error:', error);
        showError('Failed to load weather data. Please try again. Error: ' + error.message);
    }
}

// Fetch Environment Canada data with CORS proxy
async function fetchEnvironmentCanada(cityCode) {
    // Use CORS proxy to avoid CORS issues
    const url = `https://dd.weather.gc.ca/citypage_weather/xml/ON/${cityCode}_e.xml`;
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    
    console.log('Fetching from:', url);
    console.log('Using proxy:', proxyUrl);
    
    const response = await fetch(proxyUrl);
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const xmlText = await response.text();
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, 'text/xml');
    
    // Check for XML parsing errors
    const parseError = xml.querySelector('parsererror');
    if (parseError) {
        throw new Error('XML parsing error: ' + parseError.textContent);
    }
    
    return parseEnvironmentCanadaXML(xml);
}

// Parse Environment Canada XML
function parseEnvironmentCanadaXML(xml) {
    const data = {
        current: {},
        hourly: [],
        daily: [],
        alerts: []
    };
    
    // Current conditions
    const currentConditions = xml.querySelector('currentConditions');
    if (currentConditions) {
        data.current = {
            temp: currentConditions.querySelector('temperature')?.textContent || '--',
            condition: currentConditions.querySelector('condition')?.textContent || 'N/A',
            iconCode: currentConditions.querySelector('iconCode')?.textContent || '00',
            pressure: currentConditions.querySelector('pressure')?.textContent || '--',
            humidity: currentConditions.querySelector('relativeHumidity')?.textContent || '--',
            wind: currentConditions.querySelector('wind speed')?.textContent || '--',
            windChill: currentConditions.querySelector('windChill')?.textContent || null,
            humidex: currentConditions.querySelector('humidex')?.textContent || null
        };
    }
    
    // Hourly forecast
    const hourlyForecasts = xml.querySelectorAll('hourlyForecast');
    hourlyForecasts.forEach((forecast, index) => {
        if (index < 24) {
            const dateTime = forecast.getAttribute('dateTimeUTC');
            const hour = new Date(dateTime);
            
            data.hourly.push({
                time: hour.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true }),
                temp: forecast.querySelector('temperature')?.textContent || '--',
                condition: forecast.querySelector('condition')?.textContent || 'N/A',
                iconCode: forecast.querySelector('iconCode')?.textContent || '00',
                pop: forecast.querySelector('lop')?.textContent || '0',
                windChill: forecast.querySelector('windChill')?.textContent || null,
                humidex: forecast.querySelector('humidex')?.textContent || null
            });
        }
    });
    
    // Daily forecast
    const forecastGroup = xml.querySelector('forecastGroup');
    if (forecastGroup) {
        const forecasts = forecastGroup.querySelectorAll('forecast');
        let currentDay = null;
        
        forecasts.forEach(forecast => {
            const period = forecast.querySelector('period')?.textContent || '';
            const temp = forecast.querySelector('temperatures temperature')?.textContent;
            const pop = forecast.querySelector('abbreviatedForecast pop')?.textContent || '0';
            const iconCode = forecast.querySelector('abbreviatedForecast iconCode')?.textContent || '00';
            
            // Combine day/night into single day forecast
            if (!period.toLowerCase().includes('night')) {
                if (currentDay && temp) {
                    currentDay.high = temp;
                }
                currentDay = {
                    period: period,
                    high: temp || '--',
                    low: '--',
                    pop: pop,
                    iconCode: iconCode
                };
                data.daily.push(currentDay);
            } else if (currentDay && temp) {
                currentDay.low = temp;
            }
        });
    }
    
    // Alerts
    const warnings = xml.querySelectorAll('warnings event');
    warnings.forEach(warning => {
        const type = warning.getAttribute('type');
        const description = warning.getAttribute('description');
        if (type && description && type !== 'ended') {
            data.alerts.push({ type, description });
        }
    });
    
    return data;
}

// Display current weather (Session 1)
function displayCurrentWeather(data) {
    const { current, alerts } = data;
    
    // Temperature
    document.getElementById('currentTemp').textContent = current.temp ? `${current.temp}°` : '--°';
    document.getElementById('currentCondition').textContent = current.condition;
    document.getElementById('currentIcon').textContent = WEATHER_ICONS[current.iconCode] || '☀️';
    
    // Feels like
    const feelsLike = current.windChill || current.humidex || current.temp;
    document.getElementById('feelsLike').textContent = feelsLike ? `${feelsLike}°` : '--°';
    
    // Details
    document.getElementById('humidity').textContent = current.humidity ? `${current.humidity}%` : '--%';
    document.getElementById('wind').textContent = current.wind || '--';
    document.getElementById('pressure').textContent = current.pressure ? `${current.pressure} kPa` : '--';
    
    // Alerts
    const alertsContainer = document.getElementById('alerts');
    alertsContainer.innerHTML = '';
    if (alerts.length > 0) {
        alerts.forEach(alert => {
            const alertDiv = document.createElement('div');
            alertDiv.className = 'alert-banner';
            alertDiv.innerHTML = `
                <div class="alert-title">⚠️ ${alert.type}</div>
                <div class="alert-text">${alert.description}</div>
            `;
            alertsContainer.appendChild(alertDiv);
        });
    }
}

// Display hourly forecast (Session 2)
function displayHourlyForecast(data) {
    const hourlyList = document.getElementById('hourlyList');
    hourlyList.innerHTML = '';
    
    data.hourly.forEach(hour => {
        const feelsLike = hour.windChill || hour.humidex || hour.temp;
        
        const hourDiv = document.createElement('div');
        hourDiv.className = 'hourly-item';
        hourDiv.innerHTML = `
            <div class="hourly-time">${hour.time}</div>
            <div class="hourly-icon">${WEATHER_ICONS[hour.iconCode] || '☀️'}</div>
            <div class="hourly-temp">${hour.temp}°</div>
            <div class="hourly-feels">Feels ${feelsLike}°</div>
            <div class="hourly-precip">${hour.pop}%</div>
        `;
        hourlyList.appendChild(hourDiv);
    });
}

// Display daily forecast (Session 3)
function displayDailyForecast(data) {
    const dailyList = document.getElementById('dailyList');
    dailyList.innerHTML = '';
    
    data.daily.forEach((day, index) => {
        if (index < 7) {
            const dayDiv = document.createElement('div');
            dayDiv.className = 'daily-item';
            dayDiv.innerHTML = `
                <div class="daily-day">${day.period}</div>
                <div class="daily-icon">${WEATHER_ICONS[day.iconCode] || '☀️'}</div>
                <div class="daily-temps">
                    <span class="daily-high">${day.high}°</span>
                    <span class="daily-low">${day.low}°</span>
                </div>
                <div class="daily-precip">${day.pop}%</div>
            `;
            dailyList.appendChild(dayDiv);
        }
    });
}

// Fetch minute-by-minute precipitation (Session 4)
async function fetchMinutePrecipitation(lat, lon) {
    const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=current,hourly,daily,alerts&appid=${API_KEY}&units=metric`;
    
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            if (response.status === 401) {
                showAPIKeyPrompt('Invalid API key. Please check and try again.');
                return;
            }
            throw new Error('Failed to fetch precipitation data');
        }
        
        const data = await response.json();
        displayMinutePrecipitation(data.minutely || []);
    } catch (error) {
        console.error('Precipitation error:', error);
        showAPIKeyPrompt();
    }
}

// Display minute precipitation (Session 4)
function displayMinutePrecipitation(minutely) {
    const precipContent = document.getElementById('precipContent');
    
    if (!minutely || minutely.length === 0) {
        precipContent.innerHTML = `
            <div class="precipitation-card">
                <div class="precip-summary">No precipitation expected in the next hour</div>
                <div class="precip-note">Data from OpenWeatherMap</div>
            </div>
        `;
        return;
    }
    
    // Calculate summary
    const totalPrecip = minutely.reduce((sum, min) => sum + (min.precipitation || 0), 0);
    const maxPrecip = Math.max(...minutely.map(min => min.precipitation || 0));
    const hasPrecip = totalPrecip > 0;
    
    let summary = 'No precipitation expected';
    if (hasPrecip) {
        const firstPrecipIndex = minutely.findIndex(min => (min.precipitation || 0) > 0);
        if (firstPrecipIndex === 0) {
            summary = '🌧️ Precipitation happening now';
        } else if (firstPrecipIndex > 0) {
            summary = `🌧️ Precipitation starting in ${firstPrecipIndex} minutes`;
        }
    }
    
    // Create chart
    const bars = minutely.map((min, index) => {
        const height = maxPrecip > 0 ? (min.precipitation / maxPrecip) * 100 : 0;
        return `<div class="precip-bar" style="height: ${height}%" title="${index} min: ${min.precipitation.toFixed(2)} mm"></div>`;
    }).join('');
    
    precipContent.innerHTML = `
        <div class="precipitation-card">
            <div class="precip-summary">${summary}</div>
            <div class="precip-chart">
                <div class="precip-bars">${bars}</div>
            </div>
            <div class="precip-timeline">
                <span>Now</span>
                <span>15 min</span>
                <span>30 min</span>
                <span>45 min</span>
                <span>60 min</span>
            </div>
            <div class="precip-note">Minute-by-minute data from OpenWeatherMap</div>
        </div>
    `;
}

// Show API key prompt
function showAPIKeyPrompt(errorMsg = '') {
    const precipContent = document.getElementById('precipContent');
    precipContent.innerHTML = `
        <div class="api-key-prompt">
            <h3>🔑 OpenWeatherMap API Key Needed</h3>
            <p>To see minute-by-minute precipitation forecasts, add your free OpenWeatherMap API key.</p>
            <p>Get yours at: <a href="https://home.openweathermap.org/api_keys" target="_blank">OpenWeatherMap</a> (takes 2 minutes, 1000 free calls/day)</p>
            ${errorMsg ? `<p style="color: #dc2626; font-weight: 600;">${errorMsg}</p>` : ''}
            <div class="api-key-input">
                <input type="text" id="apiKeyInput" placeholder="Enter API key" value="${API_KEY}">
                <button onclick="saveAPIKey()">Save</button>
            </div>
        </div>
    `;
}

// Save API key
function saveAPIKey() {
    const input = document.getElementById('apiKeyInput');
    API_KEY = input.value.trim();
    if (API_KEY) {
        try {
            localStorage.setItem(STORAGE_KEY, API_KEY);
        } catch (e) {
            console.warn('Could not save to localStorage:', e);
        }
        fetchWeather();
    }
}

// UI State Management
function showLoading() {
    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('weatherContent').classList.add('hidden');
    document.getElementById('error').classList.add('hidden');
}

function showContent() {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('weatherContent').classList.remove('hidden');
    document.getElementById('error').classList.add('hidden');
}

function showError(message) {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('weatherContent').classList.add('hidden');
    const errorEl = document.getElementById('error');
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
}

// Initial load
fetchWeather();

// Auto-refresh every 15 minutes
setInterval(fetchWeather, 15 * 60 * 1000);
