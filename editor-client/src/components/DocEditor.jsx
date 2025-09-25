// src/components/DocEditor.js
import React, { useEffect, useRef, useState } from "react";
import { useLocation, useParams, useNavigate } from "react-router-dom";

/**
 * DocEditor
 * - Enhanced UI with modern design and collaboration features
 * - Real-time user presence and server info
 * - Improved status indicators and error handling
 */
export default function DocEditor({ docId: propDocId, wsUrlPrefix }) {
    const location = useLocation();
    const params = useParams();
    const navigate = useNavigate();
    const queryDocId = (() => {
        try {
            const p = new URLSearchParams(location.search);
            return p.get("docId");
        } catch (e) { return null; }
    })();
    const docId = propDocId || queryDocId || params.docId;
    
    if (!docId) {
        return (
            <div className="error-container">
                <div className="error-card">
                    <h2>🚫 No Document ID</h2>
                    <p>Please provide a document ID to continue.</p>
                    <button onClick={() => navigate('/')} className="back-btn">
                        ← Back to Home
                    </button>
                </div>
            </div>
        );
    }

    const [text, setText] = useState("");
    const [status, setStatus] = useState("disconnected");
    const [serverVersion, setServerVersion] = useState(0);
    const [serverInfo, setServerInfo] = useState({ id: "unknown", clients: 1 });
    const [wordCount, setWordCount] = useState(0);
    const [charCount, setCharCount] = useState(0);
    const [lastSaved, setLastSaved] = useState(null);
    const [connectionQuality, setConnectionQuality] = useState("good");
    const [showSidebar, setShowSidebar] = useState(false);
    
    const wsRef = useRef(null);
    const lastSentRef = useRef(null);
    const applyingRemote = useRef(false);
    const debounceTimer = useRef(null);
    const reconnectTimer = useRef(null);
    const reconnectAttempts = useRef(0);
    const shouldReconnect = useRef(true);
    const pendingOps = useRef([]);
    const sequenceNumber = useRef(0);
    const textareaRef = useRef(null);

    // Update text statistics
    useEffect(() => {
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        setWordCount(words);
        setCharCount(text.length);
    }, [text]);

    // Helper: generate uuid fallback
    const makeId = () => {
        if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
        return `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    };

    useEffect(() => {
        shouldReconnect.current = true;
        connect();

        // cleanup on unmount
        return () => {
            shouldReconnect.current = false;
            clearTimeout(debounceTimer.current);
            clearTimeout(reconnectTimer.current);
            if (wsRef.current) {
                try { wsRef.current.close(); } catch (e) {/* ignore */ }
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [docId]); // reconnect if docId changes

    const defaultWsUrlPrefix = (() => {
        const loc = window.location;
        const proto = loc.protocol === "https:" ? "wss:" : "ws:";
        // use relative host and path - nginx will be at same host:port serving the page
        return `${proto}//${loc.host}/ws`;
    })();

    function connect() {
        const url = `${wsUrlPrefix || defaultWsUrlPrefix}?docId=${encodeURIComponent(docId)}`;
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
            reconnectAttempts.current = 0;
            setStatus("connected");
            setConnectionQuality("good");
            setLastSaved(new Date());
            
            // request the latest snapshot from server (optional --- server needs to support it)
            const snapshotRequest = { type: "snapshot_request", docId, reqId: makeId() };
            ws.send(JSON.stringify(snapshotRequest));
            // start ping
            startPing();
            // send any pending operations
            flushPendingOps();
        };

        ws.onmessage = (evt) => {
            // messages may be snapshot or edit
            try {
                const msg = JSON.parse(evt.data);
                if (!msg || msg.docId && msg.docId !== docId) return;

                // Extract server info if available
                if (msg.serverId) {
                    setServerInfo(prev => ({ 
                        ...prev, 
                        id: msg.serverId,
                        clients: msg.clientCount || prev.clients 
                    }));
                }

                if (msg.type === "snapshot") {
                    applyingRemote.current = true;
                    setText(msg.text || "");
                    setServerVersion(msg.version || 0);
                    setLastSaved(new Date());
                    applyingRemote.current = false;
                    return;
                }

                // normal edit message: { opId, origin, docId, text, version }
                if (msg.opId && msg.opId === lastSentRef.current) {
                    // Our own operation confirmed, remove from pending
                    pendingOps.current = pendingOps.current.filter(op => op.opId !== msg.opId);
                    setLastSaved(new Date());
                    return;
                }
                
                // Check if this is a newer version than what we have
                const incomingVersion = msg.version || msg.serverVersion || 0;
                if (incomingVersion > serverVersion) {
                    applyingRemote.current = true;
                    setText(msg.text || "");
                    setServerVersion(incomingVersion);
                    setLastSaved(new Date());
                    applyingRemote.current = false;
                } else {
                    console.warn("Received older version, ignoring", incomingVersion, "vs", serverVersion);
                }
            } catch (err) {
                console.error("ws message parse error", err);
                setConnectionQuality("poor");
            }
        };

        ws.onclose = () => {
            setStatus("disconnected");
            setConnectionQuality("poor");
            stopPing();
            attemptReconnect();
        };

        ws.onerror = (e) => {
            console.error("ws error", e);
            setStatus("error");
            setConnectionQuality("poor");
            // onerror is often followed by onclose; let onclose handle reconnect
        };
    }

    // exponential backoff reconnect
    function attemptReconnect() {
        if (!shouldReconnect.current) return;
        reconnectAttempts.current += 1;
        const delay = Math.min(30_000, 500 * Math.pow(2, reconnectAttempts.current)); // capped 30s
        setStatus(`reconnecting in ${Math.round(delay / 1000)}s`);
        reconnectTimer.current = setTimeout(() => {
            connect();
        }, delay);
    }

    // ping/pong keepalive (simple)
    let pingIntervalRef = useRef(null);
    function startPing() {
        stopPing();
        pingIntervalRef.current = setInterval(() => {
            try {
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ type: "ping", ts: Date.now(), docId }));
                }
            } catch (e) { }
        }, 20_000); // every 20s
    }
    function stopPing() {
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
    }

    // send full-text update (debounced)
    function scheduleSend(newText) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => {
            sequenceNumber.current += 1;
            const op = {
                type: "edit",
                opId: makeId(),
                sequence: sequenceNumber.current,
                origin: "client",
                docId,
                text: newText,
                version: serverVersion + 1, // Base on server version
                timestamp: Date.now()
            };
            
            // Add to pending operations for reliability
            pendingOps.current.push(op);
            lastSentRef.current = op.opId;
            
            const ws = wsRef.current;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(op));
            } else {
                console.warn("WebSocket not open - operation queued");
            }
        }, 300);
    }

    // Send pending operations when connection is restored
    function flushPendingOps() {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        
        // Send pending operations in order
        pendingOps.current.forEach(op => {
            try {
                ws.send(JSON.stringify(op));
            } catch (e) {
                console.error("Failed to send pending operation", e);
            }
        });
    }

    // textarea handler
    function onChange(e) {
        const newText = e.target.value;
        setText(newText);
        if (applyingRemote.current) return;
        scheduleSend(newText);
    }

    // graceful disconnect/resume (e.g., on page hide)
    useEffect(() => {
        const onVisibility = () => {
            if (document.visibilityState === "hidden") {
                // pause reconnect attempts while hidden (optional)
                // or you may close ws to conserve resources
            }
        };
        document.addEventListener("visibilitychange", onVisibility);
        return () => document.removeEventListener("visibilitychange", onVisibility);
    }, []);

    // Format timestamp for display
    const formatTime = (date) => {
        if (!date) return "Never";
        return date.toLocaleTimeString();
    };

    // Get status indicator
    const getStatusIndicator = () => {
        switch (status) {
            case "connected":
                return { icon: "🟢", text: "Connected", color: "#22c55e" };
            case "disconnected":
                return { icon: "🔴", text: "Disconnected", color: "#ef4444" };
            case "error":
                return { icon: "⚠️", text: "Error", color: "#f59e0b" };
            default:
                return { icon: "🟡", text: status, color: "#f59e0b" };
        }
    };

    // Text formatting helpers
    const formatText = (prefix, suffix) => {
        const textarea = textareaRef.current;
        if (textarea) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const selectedText = text.substring(start, end);
            const newText = text.substring(0, start) + 
                           `${prefix}${selectedText}${suffix}` + 
                           text.substring(end);
            setText(newText);
            if (!applyingRemote.current) scheduleSend(newText);
            
            // Restore cursor position
            setTimeout(() => {
                textarea.focus();
                textarea.setSelectionRange(start + prefix.length, end + prefix.length);
            }, 0);
        }
    };

    const insertText = (insertText) => {
        const textarea = textareaRef.current;
        if (textarea) {
            const start = textarea.selectionStart;
            const newText = text.substring(0, start) + insertText + text.substring(start);
            setText(newText);
            if (!applyingRemote.current) scheduleSend(newText);
            
            // Move cursor after inserted text
            setTimeout(() => {
                textarea.focus();
                textarea.setSelectionRange(start + insertText.length, start + insertText.length);
            }, 0);
        }
    };

    const statusInfo = getStatusIndicator();

    return (
        <div className="editor">
            {/* Google Docs Style Header */}
            <div className="editor-header">
                <div className="header-left">
                    <button onClick={() => navigate('/')} className="back-btn">
                        ← Back
                    </button>
                    <input 
                        type="text" 
                        value={docId} 
                        readOnly 
                        className="doc-title"
                        placeholder="Untitled document"
                    />
                </div>
                <div className="header-right">
                    <div className="word-count">
                        {wordCount} words
                    </div>
                    <div className={`status-dot ${status}`} title={statusInfo.text}>
                        <span className="dot"></span>
                        {status === 'connected' ? 'Connected' : 
                         status === 'disconnected' ? 'Disconnected' : 
                         status.startsWith('reconnecting') ? 'Reconnecting...' : 'Error'}
                    </div>
                </div>
            </div>

            {/* Google Docs Style Toolbar */}
            <div className="toolbar">
                <button onClick={() => formatText('**', '**')} className="format-btn" title="Bold">
                    B
                </button>
                <button onClick={() => formatText('*', '*')} className="format-btn" title="Italic">
                    I
                </button>
                <button onClick={() => formatText('_', '_')} className="format-btn" title="Underline">
                    U
                </button>
                <div className="toolbar-divider"></div>
                <button onClick={() => insertText('# ')} className="format-btn" title="Heading">
                    H
                </button>
                <button onClick={() => insertText('- ')} className="format-btn" title="List">
                    •
                </button>
                <div className="toolbar-divider"></div>
                <button className="format-btn" title="Align Left">
                    ≡
                </button>
                <button className="format-btn" title="Align Center">
                    ≣
                </button>
                <div className="toolbar-spacer"></div>
                <button 
                    onClick={() => window.open(`${window.location.origin}/?docId=${docId}`, '_blank')}
                    className="share-btn"
                    title="Share document"
                >
                    🔗 Share
                </button>
            </div>

            {/* Google Docs Style Editor */}
            <div className="editor-content">
                <div className="editor-wrapper">
                    <textarea
                        ref={textareaRef}
                        value={text}
                        onChange={onChange}
                        placeholder="Start writing..."
                        className="editor-textarea"
                        spellCheck="true"
                        autoFocus
                    />
                </div>
            </div>

            {/* Google Docs Style Status Bar */}
            <div className="status-bar">
                <div className="status-info">
                    <span>Server: {serverInfo.id}</span>
                    <span>{serverInfo.clients} connected</span>
                    {lastSaved && <span>Last saved: {formatTime(lastSaved)}</span>}
                </div>
                <div className="status-info">
                    {pendingOps.current.length > 0 && (
                        <span className="pending-info">
                            {pendingOps.current.length} pending
                        </span>
                    )}
                    <span>{charCount} characters</span>
                </div>
            </div>
        </div>
    );
}
