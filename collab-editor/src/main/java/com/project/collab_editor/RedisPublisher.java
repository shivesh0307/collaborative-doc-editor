package com.project.collab_editor;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

@Service
public class RedisPublisher {
    private static final Logger logger = LoggerFactory.getLogger(RedisPublisher.class);
    private final StringRedisTemplate template;

    public RedisPublisher(StringRedisTemplate template) {
        this.template = template;
    }

    public void publish(String docId, String payload) {
        String channel = "doc:" + docId + ":ops";
        try {
            template.convertAndSend(channel, payload);
            logger.debug("Published to redis channel={} payloadLen={}", channel,
                    payload == null ? 0 : payload.length());
        } catch (Exception e) {
            logger.warn("Failed to publish to redis channel {}: {}", channel, e.getMessage(), e);
        }
    }
}
