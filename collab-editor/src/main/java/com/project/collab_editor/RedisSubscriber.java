package com.project.collab_editor;

import java.nio.charset.StandardCharsets;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

@Component
public class RedisSubscriber implements MessageListener {
    private static final Logger logger = LoggerFactory.getLogger(RedisSubscriber.class);
    private final DocWebSocketHandler handler;
    private final ObjectMapper mapper = new ObjectMapper();
    private final ServerId serverId;

    public RedisSubscriber(DocWebSocketHandler handler, ServerId serverId) {
        this.handler = handler;
        this.serverId = serverId;
    }

    @Override
    public void onMessage(Message message, byte[] pattern) {
        try {
            String payload = new String(message.getBody(), StandardCharsets.UTF_8);
            String channel = message.getChannel() == null ? ""
                    : new String(message.getChannel(), StandardCharsets.UTF_8);
            // try derive docId from channel "doc:<docId>:ops"
            String docIdFromChannel = "";
            try {
                if (channel.startsWith("doc:") && channel.endsWith(":ops")) {
                    docIdFromChannel = channel.substring(4, channel.length() - 4);
                }
            } catch (Exception ex) {
                // ignore derivation errors; fallback to payload docId
            }

            JsonNode node = mapper.readTree(payload);
            String originServer = node.path("serverId").asText("");
            String docId = node.path("docId").asText(docIdFromChannel);

            if (serverId.id.equals(originServer)) {
                logger.debug("Ignoring redis message from same server: serverId={}, channel={}", originServer, channel);
                return;
            }

            handler.broadcastFromRedis(docId, payload);
        } catch (Exception e) {
            logger.warn("RedisSubscriber failed to process message: {}", e.getMessage(), e);
        }
    }
}
