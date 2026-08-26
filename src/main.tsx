import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ServicesProvider } from "./context/ServicesProvider";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ServicesProvider>
    <App />
  </ServicesProvider>
);
