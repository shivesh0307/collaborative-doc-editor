// src/components/DocEditor.js
import React, { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";

/**
 * DocEditor
 * - If `docId` prop provided, uses it.
 * - Otherwise will check: query param ?docId=... then route param /doc/:docId
 *
 * Connects to ws://localhost:8088/ws?docId=...
 */
export default function DocEditor({ docId: propDocId, wsUrlPrefix }) {
    const location = useLocation();
    const params = useParams();
    const queryDocId = (() => {
        try {
            const p = new URLSearchParams(location.search);
            return p.get("docId");
        } catch (e) { return null; }
    })();
    const docId = propDocId || queryDocId || params.docId;
    if (!docId) {
        return <div style={{ padding: 20 }}>No docId provided. Use ?docId=demo1 or route /doc/:docId</div>;
    }

    const [text, setText] = useState("");
    const [status, setStatus] = useState("disconnected");
    const wsRef = useRef(null);
    const lastSentRef = useRef(null);
    const applyingRemote = useRef(false);
    const debounceTimer = useRef(null);
    const reconnectTimer = useRef(null);
    const reconnectAttempts = useRef(0);
    const shouldReconnect = useRef(true);

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
            // request the latest snapshot from server (optional --- server needs to support it)
            const snapshotRequest = { type: "snapshot_request", docId, reqId: makeId() };
            ws.send(JSON.stringify(snapshotRequest));
            // start ping
            startPing();
        };

        ws.onmessage = (evt) => {
            // messages may be snapshot or edit
            try {
                const msg = JSON.parse(evt.data);
                if (!msg || msg.docId && msg.docId !== docId) return;

                if (msg.type === "snapshot") {
                    applyingRemote.current = true;
                    setText(msg.text || "");
                    applyingRemote.current = false;
                    return;
                }

                // normal edit message: { opId, origin, docId, text, version }
                if (msg.opId && msg.opId === lastSentRef.current) return;
                applyingRemote.current = true;
                setText(msg.text || "");
                applyingRemote.current = false;
            } catch (err) {
                console.error("ws message parse error", err);
            }
        };

        ws.onclose = () => {
            setStatus("disconnected");
            stopPing();
            attemptReconnect();
        };

        ws.onerror = (e) => {
            console.error("ws error", e);
            setStatus("error");
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
            const op = {
                type: "edit",
                opId: makeId(),
                origin: "client",
                docId,
                text: newText,
                version: Date.now()
            };
            lastSentRef.current = op.opId;
            const ws = wsRef.current;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(op));
            } else {
                console.warn("WebSocket not open - cannot send");
            }
        }, 300);
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

    return (
        <div style={{ fontFamily: "system-ui", maxWidth: 900, margin: "12px auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <div><strong>Doc:</strong> {docId}</div>
                <div style={{ fontSize: 12, color: "#666" }}>WS: {status}</div>
            </div>

            <textarea
                value={text}
                onChange={onChange}
                placeholder="Start typing..."
                style={{ width: "100%", height: 420, padding: 12, fontSize: 15, lineHeight: 1.4, borderRadius: 6, border: "1px solid #ddd", boxSizing: "border-box" }}
            />

            <div style={{ marginTop: 8, fontSize: 12, color: "#555" }}>
                Simple LWW (last-write-wins) sync. Replace with OT/CRDT for real concurrency.
            </div>
        </div>
    );
}
