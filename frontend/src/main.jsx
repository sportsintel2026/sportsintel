// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import "./maintenance.css";

function MaintenancePage() {
  return (
    <main className="maintenance-page">
      <section className="maintenance-card" aria-labelledby="maintenance-title">
        <div className="maintenance-brand">WizePicks</div>
        <div className="maintenance-rule" aria-hidden="true" />
        <p className="maintenance-kicker">TEMPORARY MAINTENANCE</p>
        <h1 id="maintenance-title">UNDER CONSTRUCTION</h1>
        <p className="maintenance-message">
          We’re temporarily offline.<br />
          WizePicks is currently on hold while we work on the next version of the platform.<br />
          Thanks for checking in — we’ll be back.
        </p>
      </section>
    </main>
  );
}

ReactDOM.hydrateRoot(
  document.getElementById("root"),
  <React.StrictMode>
    <MaintenancePage />
  </React.StrictMode>
);
