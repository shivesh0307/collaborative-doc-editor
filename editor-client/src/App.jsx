// src/App.js
import React from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import DocEditor from "./components/DocEditor";

function Home() {
  return (
    <div style={{ padding: 20 }}>
      <div>No document selected</div>
      <h2>Open a document</h2>
      <p>Examples:</p>
      <ul>
        <li><a href="/?docId=demo1">/?docId=demo1</a></li>
        <li><a href="/doc/demo1">/doc/demo1</a></li>
      </ul>
    </div>
  );
}

// wrapper that chooses Home or DocEditor based on query param
function HomeOrEditor() {
  const loc = useLocation();
  const q = new URLSearchParams(loc.search);
  const docId = q.get("docId");
  if (docId) return <DocEditor docId={docId} />;
  return <Home />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeOrEditor />} />
        <Route path="/doc/:docId" element={<DocEditor />} />
      </Routes>
    </BrowserRouter>
  );
}
