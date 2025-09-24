package com.project.collab_editor;

import org.springframework.stereotype.Component;

@Component
public class ServerId {
    public final String id = System.getenv().getOrDefault("SERVER_ID", "local");
}
