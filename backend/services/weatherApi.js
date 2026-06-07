// Weather API client — Open-Meteo (free, no API key required)
// Docs: https://open-meteo.com/en/docs

const axios = require("axios");

// MLB venue coordinates (lat, lon, orientation in degrees)
// orientation = bearing from home plate to center field (degrees from North)
// Used to determine if wind is blowing IN, OUT, or across
const VENUE_COORDS = {
  "Rogers Centre": { lat: 43.6414, lon: -79.3894, orientation: 0, indoor: true },
  "Progressive Field": { lat: 41.4962, lon: -81.6852, orientation: 0 },
  "American Family Field": { lat: 43.0280, lon: -87.9712, orientation: 135, indoor: true },
  "Sutter Health Park": { lat: 38.5805, lon: -121.5135, orientation: 30 },
  "Oracle Park": { lat: 37.7786, lon: -122.3893, orientation: 90 },
  "Petco Park": { lat: 32.7073, lon: -117.1566, orientation: 0 },
  "Oriole Park at Camden Yards": { lat: 39.2839, lon: -76.6217, orientation: 33 },
  "Comerica Park": { lat: 42.3390, lon: -83.0485, orientation: 150 },
  "PNC Park": { lat: 40.4469, lon: -80.0057, orientation: 117 },
  "Fenway Park": { lat: 42.3467, lon: -71.0972, orientation: 45 },
  "Citi Field": { lat: 40.7571, lon: -73.8458, orientation: 25 },
  "Rate Field": { lat: 41.8300, lon: -87.6338, orientation: 130 },
  "Kauffman Stadium": { lat: 39.0517, lon: -94.4803, orientation: 45 },
  "Globe Life Field": { lat: 32.7473, lon: -97.0847, orientation: 0, indoor: true },
  "UNIQLO Field at Dodger Stadium": { lat: 34.0739, lon: -118.2400, orientation: 25 },
  "Dodger Stadium": { lat: 34.0739, lon: -118.2400, orientation: 25 },
  "Yankee Stadium": { lat: 40.8296, lon: -73.9262, orientation: 75 },
  "Wrigley Field": { lat: 41.9484, lon: -87.6553, orientation: 36 },
  "Truist Park": { lat: 33.8908, lon: -84.4677, orientation: 144 },
  "loanDepot park": { lat: 25.7781, lon: -80.2197, orientation: 40, indoor: true },
  "Minute Maid Park": { lat: 29.7572, lon: -95.3554, orientation: 30, indoor: true },
  "T-Mobile Park": { lat: 47.5914, lon: -122.3325, orientation: 45, indoor: true },
  "Coors Field": { lat: 39.7559, lon: -104.9942, orientation: 0 },
  "Great American Ball Park": { lat: 39.0974, lon: -84.5071, orientation: 122 },
  "Busch Stadium": { lat: 38.6226, lon: -90.1928, orientation: 67 },
  "Target Field": { lat: 44.9817, lon: -93.2776, orientation: 90 },
  "Tropicana Field": { lat: 27.7682, lon: -82.6534, orientation: 45, indoor: true },
  "Nationals Park": { lat: 38.8730, lon: -77.0074, orientation: 30 },
  "Citizens Bank Park": { lat: 39.9061, lon: -75.1665, orientation: 15 },
  "Angel Stadium": { lat: 33.8003, lon: -117.8827, orientation: 41 },
  // Retractable-roof parks played closed in summer heat — treat as indoor (weather neutral).
  "Daikin Park": { lat: 29.7572, lon: -95.3554, orientation: 30, indoor: true }, // HOU (was Minute Maid Park)
  "Chase Field": { lat: 33.4453, lon: -112.0667, orientation: 0, indoor: true }, // AZ (was missing entirely)
};

const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — weather doesn't change that fast

function isCacheValid(entry) {
  return entry && (Date.now() - entry.fetchedAt) < CACHE_TTL_MS;
}

// Get weather for a venue (returns null if indoor or unknown venue)
async function getWeatherForVenue(venueName, gameTimeISO) {
  const venue = VENUE_COORDS[venueName];
  if (!venue) {
    console.log(`[Weather] Unknown venue: ${venueName}`);
    return null;
  }
  if (venue.indoor) {
    return {
      indoor: true,
      venue: venueName,
      summary: "Indoor stadium — weather doesn't affect play",
    };
  }

  const cacheKey = `${venueName}_${gameTimeISO || "now"}`;
  const cached = cache.get(cacheKey);
  if (isCacheValid(cached)) return cached.data;

  try {
    const wantHourly = !!gameTimeISO;
    const res = await axios.get("https://api.open-meteo.com/v1/forecast", {
      params: {
        latitude: venue.lat,
        longitude: venue.lon,
        current: "temperature_2m,wind_speed_10m,wind_direction_10m,precipitation,weather_code",
        ...(wantHourly ? { hourly: "temperature_2m,wind_speed_10m,wind_direction_10m,precipitation,weather_code", forecast_days: 2 } : {}),
        temperature_unit: "fahrenheit",
        wind_speed_unit: "mph",
        timezone: "auto",
      },
      timeout: 6000,
    });

    // Default to current conditions; if a first-pitch time is given, swap in the
    // forecast hour nearest first pitch (open-air totals/HR depend on GAME-TIME
    // wind & temp, not whenever the cron happened to run). Falls back to current
    // if the hour can't be matched within ~2h.
    let src = res.data?.current;
    let forecastAtGameTime = false;
    if (wantHourly && res.data?.hourly?.time?.length) {
      const h = res.data.hourly;
      const offsetMs = (res.data.utc_offset_seconds || 0) * 1000;
      const target = Date.parse(gameTimeISO);
      if (Number.isFinite(target)) {
        let bestIdx = -1, bestDiff = Infinity;
        for (let i = 0; i < h.time.length; i++) {
          const hourUTC = Date.parse(h.time[i] + "Z") - offsetMs; // local → UTC instant
          const diff = Math.abs(hourUTC - target);
          if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
        }
        if (bestIdx >= 0 && bestDiff <= 2 * 3600 * 1000) {
          src = {
            temperature_2m: h.temperature_2m?.[bestIdx],
            wind_speed_10m: h.wind_speed_10m?.[bestIdx],
            wind_direction_10m: h.wind_direction_10m?.[bestIdx],
            precipitation: h.precipitation?.[bestIdx],
            weather_code: h.weather_code?.[bestIdx],
          };
          forecastAtGameTime = true;
        }
      }
    }
    if (!src || src.temperature_2m == null) return null;

    const tempF = Math.round(src.temperature_2m);
    const windMph = Math.round(src.wind_speed_10m);
    const windDir = src.wind_direction_10m; // degrees from N
    const precip = src.precipitation;
    const code = src.weather_code;

    // Calculate wind direction relative to home plate → CF
    // If wind direction matches venue orientation (±45deg), wind is "out to CF"
    // If wind direction is 180° opposite, wind is "in from CF" (suppresses HRs)
    const relativeAngle = Math.abs(((windDir - venue.orientation + 540) % 360) - 180);
    let windEffect;
    let windLabel;
    if (windMph < 5) {
      windEffect = "calm";
      windLabel = "Calm winds";
    } else if (relativeAngle < 45) {
      windEffect = "in"; // blowing toward home plate from CF — suppresses
      windLabel = `Wind blowing IN ${windMph} mph`;
    } else if (relativeAngle > 135) {
      windEffect = "out"; // blowing out to CF — boosts HRs
      windLabel = `Wind blowing OUT ${windMph} mph`;
    } else {
      windEffect = "cross";
      windLabel = `Cross wind ${windMph} mph`;
    }

    // Temperature effect: warm air = ball flies farther
    let tempEffect;
    if (tempF > 80) tempEffect = "hot"; // boosts offense
    else if (tempF < 55) tempEffect = "cold"; // suppresses
    else tempEffect = "neutral";

    const conditions = describeWeatherCode(code);
    const isRaining = precip > 0.1;

    const result = {
      indoor: false,
      venue: venueName,
      tempF,
      windMph,
      windDir,
      windEffect, // "in" | "out" | "cross" | "calm"
      windLabel,
      tempEffect, // "hot" | "cold" | "neutral"
      conditions,
      isRaining,
      forecastAtGameTime,
      summary: buildSummary({ tempF, windEffect, windMph, tempEffect, conditions, isRaining }),
    };

    cache.set(cacheKey, { data: result, fetchedAt: Date.now() });
    return result;
  } catch (e) {
    console.error(`[Weather] Error for ${venueName}:`, e.message);
    return null;
  }
}

function describeWeatherCode(code) {
  // Open-Meteo WMO weather codes
  if (code === 0) return "Clear";
  if (code === 1 || code === 2) return "Partly cloudy";
  if (code === 3) return "Cloudy";
  if (code >= 45 && code <= 48) return "Foggy";
  if (code >= 51 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code >= 95) return "Thunderstorm";
  return "Unknown";
}

function buildSummary({ tempF, windEffect, windMph, tempEffect, conditions, isRaining }) {
  if (isRaining) return `🌧 Rain — game may be delayed`;

  let summary = `${conditions}, ${tempF}°F`;
  if (windMph >= 5) {
    if (windEffect === "out") summary += ` · 💨 Wind OUT (${windMph}mph — favors hitters)`;
    else if (windEffect === "in") summary += ` · 💨 Wind IN (${windMph}mph — favors pitchers)`;
    else summary += ` · 💨 Cross wind ${windMph}mph`;
  }
  if (tempEffect === "hot") summary += ` · 🔥 Warm air carries`;
  if (tempEffect === "cold") summary += ` · 🥶 Cold air suppresses`;
  return summary;
}

module.exports = {
  getWeatherForVenue,
};
