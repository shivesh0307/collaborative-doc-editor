package com.project.collab_editor;

import java.io.IOException;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * WebSocket handler for collaborative document editing.
 *
 * - Keeps in-memory session lists per docId
 * - Keeps in-memory snapshot per docId
 * - Loads snapshot from Redis on first access
 * - Applies client ops and publishes them to Redis so other servers can apply
 * - Applies Redis ops (ignores ones originated from same serverId)
 *
 * Notes:
 * - Handshake interceptor should place "docId" into session attributes for
 * SockJS compatibility (see DocIdHandshakeInterceptor).
 * - For production, replace CompletableFuture.runAsync(...) with a bounded
 * ExecutorService.
 */
@Component
public class DocWebSocketHandler extends TextWebSocketHandler {
    private static final Logger logger = LoggerFactory.getLogger(DocWebSocketHandler.class);

    // docId -> set of sessions
    private final ConcurrentHashMap<String, Set<WebSocketSession>> docSessions = new ConcurrentHashMap<>();
    // docId -> state
    private final ConcurrentHashMap<String, DocumentState> docStates = new ConcurrentHashMap<>();
    private final ExecutorService persistenceExecutor = Executors.newFixedThreadPool(4);

    private final RedisPublisher redisPublisher;
    private final StringRedisTemplate redisTemplate;
    private final String serverId;
    private final ObjectMapper mapper = new ObjectMapper();

    public DocWebSocketHandler(RedisPublisher redisPublisher, StringRedisTemplate redisTemplate,
            ServerId serverIdBean) {
        this.redisPublisher = redisPublisher;
        this.redisTemplate = redisTemplate;
        this.serverId = serverIdBean != null ? serverIdBean.id : "local";
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        String docId = getDocId(session);
        if (docId == null) {
            logger.warn("No docId supplied in websocket connect, closing session {}", session.getId());
            session.close(CloseStatus.NOT_ACCEPTABLE.withReason("missing docId"));
            return;
        }

        // store docId in session attributes for SockJS/handshake compat
        try {
            session.getAttributes().put("docId", docId);
        } catch (Exception e) {
            logger.debug("Unable to set docId into session attributes: {}", e.getMessage());
        }

        docSessions.computeIfAbsent(docId, k -> ConcurrentHashMap.newKeySet()).add(session);
        logger.info("WS connected. server={}, sessionId={}, remoteAddr={}, docId={}",
                serverId, session.getId(), session.getRemoteAddress(), docId);

        // load snapshot into memory if not present (atomic computeIfAbsent)
        DocumentState ds = docStates.computeIfAbsent(docId, k -> {
            DocumentState loaded = loadDocState(docId);
            return loaded != null ? loaded : new DocumentState("", 0L);
        });

        // send snapshot to newly connected client (thread-safe)
        try {
            ObjectNode envelope = mapper.createObjectNode();
            envelope.put("type", "snapshot");
            envelope.put("version", ds.version);
            envelope.put("text", ds.text);
            envelope.put("serverId", serverId); // Include server ID
            
            synchronized (session) {
                session.sendMessage(new TextMessage(envelope.toString()));
            }
        } catch (IOException e) {
            logger.warn("Failed to send snapshot to session {}: {}", session.getId(), e.getMessage());
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        String docId = getDocId(session);
        logger.info("WS closed. server={}, sessionId={}, docId={}, status={}", serverId, session.getId(), docId,
                status);

        if (docId != null) {
            Set<WebSocketSession> sessions = docSessions.get(docId);
            if (sessions != null) {
                sessions.remove(session);
                if (sessions.isEmpty()) {
                    docSessions.remove(docId);
                    // Optionally evict docStates to save memory:
                    // docStates.remove(docId);
                }
            }
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String payload = message.getPayload();
        String docId = getDocId(session);
        if (docId == null) {
            logger.warn("Received message without docId from session {}", session.getId());
            return;
        }

        try {
            JsonNode msg = mapper.readTree(payload);
            String type = msg.has("type") ? msg.get("type").asText() : "op";

            if ("op".equals(type) || "edit".equals(type)) {
                // read incoming fields
                String incomingText = msg.has("text") ? msg.get("text").asText() : null;
                long incomingVersion = msg.has("version") ? msg.get("version").asLong() : -1L;

                DocumentState current = docStates.get(docId);
                if (current == null)
                    current = new DocumentState("", 0L);

                // Use server-side monotonic versioning to prevent race conditions
                long newVersion = Math.max(current.version + 1, incomingVersion + 1);

                // Always apply the operation but log potential conflicts
                if (incomingVersion >= 0 && incomingVersion < current.version) {
                    logger.warn("Applying potentially conflicting op for doc {}: incomingVersion={} currentVersion={} newVersion={}", 
                            docId, incomingVersion, current.version, newVersion);
                }

                String newText = incomingText != null ? incomingText : current.text;
                DocumentState newDs = new DocumentState(newText, newVersion);
                docStates.put(docId, newDs);

                // publish to Redis FIRST to ensure ordering
                ObjectNode out = mapper.createObjectNode();
                out.put("serverId", serverId);
                out.put("docId", docId);
                out.put("type", "op");
                out.put("serverVersion", newDs.version); // Add server version
                out.set("payload", msg);
                try {
                    redisPublisher.publish(docId, out.toString());
                } catch (Exception e) {
                    logger.warn("Failed to publish to redis for doc {}: {}", docId, e.getMessage(), e);
                }

                // broadcast locally AFTER Redis to maintain order
                // Enhance the message with server info for local broadcast
                ObjectNode enhancedMsg = mapper.createObjectNode();
                enhancedMsg.put("serverId", serverId);
                enhancedMsg.put("serverVersion", newDs.version);
                enhancedMsg.setAll((ObjectNode) msg);
                broadcastToLocalSessions(docId, enhancedMsg.toString());

                // persist snapshot asynchronously (non-blocking)
                persistSnapshotAsync(docId, newDs);
            } else if ("ping".equals(type)) {
                ObjectNode reply = mapper.createObjectNode();
                reply.put("type", "pong");
                reply.put("serverId", serverId); // Include server ID in pong
                reply.put("timestamp", System.currentTimeMillis());
                synchronized (session) {
                    session.sendMessage(new TextMessage(reply.toString()));
                }
            } else {
                // unknown types: broadcast to local sessions
                broadcastToLocalSessions(docId, payload);
            }
        } catch (Exception e) {
            logger.error("Error handling message for session {} doc {}: {}", session.getId(), docId, e.getMessage(), e);
        }
    }

    // Called by RedisSubscriber when a message arrives from Redis
    public void broadcastFromRedis(String docId, String payload) {
        try {
            JsonNode node = mapper.readTree(payload);
            String originServer = node.has("serverId") ? node.get("serverId").asText() : "";
            if (serverId.equals(originServer)) {
                // ignore our own messages
                return;
            }
            // payload contains envelope with "payload" field (the original op)
            JsonNode inner = node.has("payload") ? node.get("payload") : node;

            String incomingText = inner.has("text") ? inner.get("text").asText() : null;
            long incomingVersion = inner.has("version") ? inner.get("version").asLong() : -1L;
            long serverVersion = node.has("serverVersion") ? node.get("serverVersion").asLong() : -1L;

            DocumentState current = docStates.get(docId);
            if (current == null)
                current = new DocumentState("", 0L);

            // Use server version if available, otherwise use monotonic increment
            long newVersion = serverVersion > 0 ? serverVersion : Math.max(current.version + 1, incomingVersion + 1);

            // Apply operation if server version is newer, or if no server version but client version is newer
            boolean shouldApply = (serverVersion > 0 && serverVersion > current.version) ||
                                (serverVersion <= 0 && incomingVersion > current.version);
            
            if (!shouldApply) {
                logger.debug("Ignoring redis op: doc={} serverVersion={} incomingVersion={} currentVersion={}", 
                        docId, serverVersion, incomingVersion, current.version);
                return;
            }

            String newText = incomingText != null ? incomingText : current.text;
            DocumentState newDs = new DocumentState(newText, newVersion);
            docStates.put(docId, newDs);

            // persist snapshot (async)
            persistSnapshotAsync(docId, newDs);

            // broadcast to local sessions (enhance the inner payload with server info)
            try {
                ObjectNode enhancedMsg = (ObjectNode) inner.deepCopy();
                enhancedMsg.put("serverId", originServer);
                enhancedMsg.put("serverVersion", newVersion);
                broadcastToLocalSessions(docId, enhancedMsg.toString());
            } catch (Exception ex) {
                logger.debug("Failed to enhance cross-server message, using original: {}", ex.getMessage());
                broadcastToLocalSessions(docId, inner.toString());
            }
        } catch (Exception e) {
            logger.warn("Failed to process redis message for doc {}: {}", docId, e.getMessage(), e);
        }
    }

    // helper - send payload string to all sessions for docId (thread-safe)
    private void broadcastToLocalSessions(String docId, String payload) {
        Set<WebSocketSession> sessions = docSessions.getOrDefault(docId, Collections.emptySet());
        // Create a copy to avoid concurrent modification during iteration
        Set<WebSocketSession> sessionsCopy = new HashSet<>(sessions);
        
        for (WebSocketSession s : sessionsCopy) {
            if (!s.isOpen()) {
                // Clean up closed sessions
                sessions.remove(s);
                continue;
            }
            
            // Use synchronization to prevent concurrent writes to the same session
            synchronized (s) {
                try {
                    s.sendMessage(new TextMessage(payload));
                } catch (IOException e) {
                    logger.warn("Failed to send message to session {}: {}, closing session", s.getId(), e.getMessage());
                    try {
                        s.close(CloseStatus.SERVER_ERROR);
                        sessions.remove(s);
                    } catch (IOException ex) {
                        // ignore
                    }
                } catch (IllegalStateException e) {
                    logger.warn("WebSocket in invalid state for session {}: {}", s.getId(), e.getMessage());
                    // Don't close session for state issues, they might recover
                }
            }
        }
    }

    /**
     * Load snapshot from Redis if present. Returns null if not found or on error.
     */
    public DocumentState loadDocState(String docId) {
        // check in-memory first
        DocumentState state = docStates.get(docId);
        if (state != null)
            return state;

        try {
            String key = "doc:" + docId + ":snapshot";
            String json = redisTemplate.opsForValue().get(key);
            if (json != null) {
                JsonNode n = mapper.readTree(json);
                String text = n.has("text") ? n.get("text").asText() : "";
                long v = n.has("version") ? n.get("version").asLong() : 0L;
                DocumentState ds = new DocumentState(text, v);
                docStates.put(docId, ds);
                return ds;
            }
        } catch (Exception e) {
            logger.warn("Failed to load snapshot from redis for {}: {}", docId, e.getMessage(), e);
        }
        return null;
    }

    // async persist helper - use a bounded executor in production
    
    private void persistSnapshotAsync(String docId, DocumentState ds) {
        persistenceExecutor.submit(() -> persistSnapshot(docId, ds));
    }

    // synchronous persist (wrapped by async helper)
    private void persistSnapshot(String docId, DocumentState ds) {
        try {
            String key = "doc:" + docId + ":snapshot";
            ObjectNode node = mapper.createObjectNode();
            node.put("text", ds.text);
            node.put("version", ds.version);
            redisTemplate.opsForValue().set(key, node.toString());
        } catch (Exception e) {
            logger.warn("Failed to persist snapshot for {}: {}", docId, e.getMessage(), e);
        }
    }

    /**
     * Extract docId: prefer session attribute (set by handshake interceptor),
     * fallback to parsing the URI query.
     */
    private String getDocId(WebSocketSession session) {
        try {
            Object attr = session.getAttributes().get("docId");
            if (attr instanceof String && !((String) attr).isEmpty()) {
                return (String) attr;
            }
            URI uri = session.getUri();
            if (uri == null)
                return null;
            String q = uri.getQuery();
            if (q == null)
                return null;
            for (String p : q.split("&")) {
                String[] parts = p.split("=", 2);
                if (parts.length == 2 && "docId".equals(parts[0])) {
                    return URLDecoder.decode(parts[1], StandardCharsets.UTF_8.name());
                }
            }
            return null;
        } catch (Exception e) {
            logger.warn("Failed to parse docId from session {}: {}", session.getId(), e.getMessage());
            return null;
        }
    }

    // small inner immutable-like class
    public static class DocumentState {
        public final String text;
        public final long version;

        public DocumentState() {
            this("", 0L);
        }

        public DocumentState(String text, long version) {
            this.text = text;
            this.version = version;
        }
    }
}
