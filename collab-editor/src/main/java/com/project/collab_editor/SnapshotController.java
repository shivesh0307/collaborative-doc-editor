package com.project.collab_editor;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class SnapshotController {
    private final StringRedisTemplate redisTemplate;

    public SnapshotController(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    @GetMapping("/{docId}")
    public ResponseEntity<String> getSnapshot(@PathVariable String docId) {
        String key = "doc:" + docId + ":snapshot";
        String json = redisTemplate.opsForValue().get(key);
        if (json == null)
            return ResponseEntity.notFound().build();
        return ResponseEntity.ok(json);
    }
}