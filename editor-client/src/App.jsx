// src/App.js
import React, { useState } from "react";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import DocEditor from "./components/DocEditor";

function Home() {
  const navigate = useNavigate();
  const [docId, setDocId] = useState("");

  const handleCreateDoc = () => {
    if (!docId.trim()) return;
    navigate(`/?docId=${encodeURIComponent(docId.trim())}`);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') handleCreateDoc();
  };

  const quickDocs = [
    { id: "demo", title: "Demo Document" },
    { id: "meeting-notes", title: "Meeting Notes" },
    { id: "brainstorm", title: "Brainstorming" }
  ];

  return (
    <div className="home">
      <div className="container">
        <header className="home-header">
          <h1 className="app-title">CollabEdit</h1>
          <p className="app-subtitle">Simple collaborative document editing</p>
        </header>

        <main className="home-main">
          <div className="create-doc">
            <div className="input-group">
              <input
                type="text"
                value={docId}
                onChange={(e) => setDocId(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Enter document name..."
                className="doc-input"
              />
              <button 
                onClick={handleCreateDoc} 
                className="create-btn" 
                disabled={!docId.trim()}
              >
                Open
              </button>
            </div>
          </div>

          <div className="quick-start">
            <p className="quick-title">Quick start:</p>
            <div className="quick-docs">
              {quickDocs.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => navigate(`/?docId=${doc.id}`)}
                  className="quick-doc"
                >
                  {doc.title}
                </button>
              ))}
            </div>
          </div>
        </main>

        <footer className="home-footer">
          <p>Real-time collaboration • WebSocket + Redis</p>
        </footer>
      </div>
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
