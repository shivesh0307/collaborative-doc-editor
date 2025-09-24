package com.project.collab_editor;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.util.StringUtils;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

public class DocIdHandshakeInterceptor implements HandshakeInterceptor {
    private static final Logger logger = LoggerFactory.getLogger(DocIdHandshakeInterceptor.class);

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response, WebSocketHandler wsHandler,
            Map<String, Object> attributes) throws Exception {
        try {
            String query = request.getURI().getQuery();
            if (!StringUtils.hasText(query)) {
                return true;
            }
            for (String p : query.split("&")) {
                String[] parts = p.split("=", 2);
                if (parts.length == 2 && "docId".equals(parts[0])) {
                    String docId = URLDecoder.decode(parts[1], StandardCharsets.UTF_8.name());
                    attributes.put("docId", docId);
                    logger.debug("Handshake captured docId={}", docId);
                    break;
                }
            }
        } catch (Exception e) {
            logger.warn("Failed to parse docId in handshake: {}", e.getMessage());
        }
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response, WebSocketHandler wsHandler,
            Exception exception) {
    }
}
