package com.project.collab_editor;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {
    private final DocWebSocketHandler handler;

    public WebSocketConfig(DocWebSocketHandler handler) {
        this.handler = handler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        // Raw WebSocket endpoint
        registry.addHandler(handler, "/ws")
                .addInterceptors(new DocIdHandshakeInterceptor())
                .setAllowedOrigins("*");
        
        // SockJS fallback endpoint  
        registry.addHandler(handler, "/ws-sockjs")
                .addInterceptors(new DocIdHandshakeInterceptor())
                .setAllowedOrigins("*")
                .withSockJS();
    }
}