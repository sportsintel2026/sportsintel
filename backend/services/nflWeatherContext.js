const { getWeatherForVenue } = require("./weatherApi");

// Exact ESPN venue-name adapter. Coordinates are used only to query the existing
// cached Open-Meteo client; no geocoding/provider discovery is performed.
const NFL_VENUES = {
  "State Farm Stadium": { lat: 33.5276, lon: -112.2626, indoor: true },
  "Mercedes-Benz Stadium": { lat: 33.7554, lon: -84.4008, indoor: true },
  "M&T Bank Stadium": { lat: 39.2780, lon: -76.6227 },
  "Highmark Stadium": { lat: 42.7738, lon: -78.7870 },
  "Bank of America Stadium": { lat: 35.2258, lon: -80.8528 },
  "Soldier Field": { lat: 41.8623, lon: -87.6167 },
  "Paycor Stadium": { lat: 39.0954, lon: -84.5160 },
  "Huntington Bank Field": { lat: 41.5061, lon: -81.6995 },
  "AT&T Stadium": { lat: 32.7473, lon: -97.0945, indoor: true },
  "Empower Field at Mile High": { lat: 39.7439, lon: -105.0201 },
  "Ford Field": { lat: 42.3400, lon: -83.0456, indoor: true },
  "Lambeau Field": { lat: 44.5013, lon: -88.0622 },
  "NRG Stadium": { lat: 29.6847, lon: -95.4107, indoor: true },
  "Lucas Oil Stadium": { lat: 39.7601, lon: -86.1639, indoor: true },
  "EverBank Stadium": { lat: 30.3239, lon: -81.6373 },
  "GEHA Field at Arrowhead Stadium": { lat: 39.0489, lon: -94.4839 },
  "Arrowhead Stadium": { lat: 39.0489, lon: -94.4839 },
  "Allegiant Stadium": { lat: 36.0908, lon: -115.1830, indoor: true },
  "SoFi Stadium": { lat: 33.9535, lon: -118.3392, indoor: true },
  "Hard Rock Stadium": { lat: 25.9580, lon: -80.2389 },
  "U.S. Bank Stadium": { lat: 44.9736, lon: -93.2575, indoor: true },
  "Gillette Stadium": { lat: 42.0909, lon: -71.2643 },
  "Caesars Superdome": { lat: 29.9511, lon: -90.0812, indoor: true },
  "MetLife Stadium": { lat: 40.8135, lon: -74.0745 },
  "Lincoln Financial Field": { lat: 39.9008, lon: -75.1675 },
  "Acrisure Stadium": { lat: 40.4468, lon: -80.0158 },
  "Levi's Stadium": { lat: 37.4030, lon: -121.9700 },
  "Lumen Field": { lat: 47.5952, lon: -122.3316 },
  "Raymond James Stadium": { lat: 27.9759, lon: -82.5033 },
  "Nissan Stadium": { lat: 36.1665, lon: -86.7713 },
  "Northwest Stadium": { lat: 38.9077, lon: -76.8645 },
  "Wembley Stadium": { lat: 51.5560, lon: -0.2796 },
  "Tottenham Hotspur Stadium": { lat: 51.6043, lon: -0.0664 },
  "Deutsche Bank Park": { lat: 50.0686, lon: 8.6455 },
  "Allianz Arena": { lat: 48.2188, lon: 11.6247 },
  "Estadio Santiago Bernabéu": { lat: 40.4531, lon: -3.6883 },
  "Melbourne Cricket Ground": { lat: -37.8200, lon: 144.9834 },
};

function resolveNflVenue(espnGame) {
  const venue = espnGame?.venue || null;
  const name = venue?.name || null;
  if (!name) return null;
  const mapped = NFL_VENUES[name] || null;
  if (!mapped) return { id: venue.id || null, name, mapped: false, indoor: venue.indoor ?? null };
  return {
    id: venue.id || null,
    name,
    mapped: true,
    lat: mapped.lat,
    lon: mapped.lon,
    // ESPN's current event-specific roof flag wins when present. The static flag
    // is a safe fallback for fixed/retractable-roof venues only.
    indoor: typeof venue.indoor === "boolean" ? venue.indoor : mapped.indoor === true,
  };
}

async function getNflGameWeather(espnGame, {
  capturedAt = new Date().toISOString(),
  weatherFetcher = getWeatherForVenue,
} = {}) {
  const venue = resolveNflVenue(espnGame);
  const kickoffAt = espnGame?.date || null;
  if (!venue) {
    return { available: false, reason: "missing-espn-venue", capturedAt, kickoffAt };
  }
  if (venue.indoor === true) {
    return {
      available: true,
      source: "espn-event-venue",
      capturedAt,
      kickoffAt,
      venueId: venue.id,
      venueName: venue.name,
      indoor: true,
      tempF: null,
      windMph: null,
      precipitation: null,
      weatherCode: null,
      severeCondition: null,
      forecastAtGameTime: true,
    };
  }
  if (!venue.mapped) {
    return {
      available: false,
      reason: "unmapped-espn-venue",
      capturedAt,
      kickoffAt,
      venueId: venue.id,
      venueName: venue.name,
      indoor: venue.indoor,
    };
  }
  if (!kickoffAt) {
    return {
      available: false,
      reason: "missing-kickoff",
      capturedAt,
      kickoffAt: null,
      venueId: venue.id,
      venueName: venue.name,
      indoor: false,
    };
  }

  const weather = await weatherFetcher(venue.name, kickoffAt, {
    venue: { lat: venue.lat, lon: venue.lon, orientation: null, indoor: false },
    forecastDays: 8,
  });
  if (!weather) {
    return {
      available: false,
      reason: "weather-unavailable",
      capturedAt,
      kickoffAt,
      venueId: venue.id,
      venueName: venue.name,
      indoor: false,
    };
  }
  // A current observation is not a truthful game-time forecast. Retain the
  // capture failure state instead of labeling it prediction-time weather.
  if (weather.forecastAtGameTime !== true) {
    return {
      available: false,
      reason: "game-time-forecast-unavailable",
      capturedAt,
      kickoffAt,
      venueId: venue.id,
      venueName: venue.name,
      indoor: false,
    };
  }
  return {
    available: true,
    source: "open-meteo-cached-game-time",
    capturedAt,
    kickoffAt,
    venueId: venue.id,
    venueName: venue.name,
    indoor: false,
    tempF: weather.tempF ?? null,
    windMph: weather.windMph ?? null,
    precipitation: weather.precipitation ?? null,
    weatherCode: weather.weatherCode ?? null,
    severeCondition: weather.severeCondition ?? null,
    conditions: weather.conditions ?? null,
    forecastAtGameTime: true,
  };
}

module.exports = {
  NFL_VENUES,
  resolveNflVenue,
  getNflGameWeather,
};
