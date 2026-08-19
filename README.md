# Kiếm Thế Mobi – Bản 4.11.1.0 Client + Server

## Kiến trúc
- `index.html`: client chạy Safari/điện thoại.
- `server.js`: Node.js WebSocket server, server-authoritative cho vị trí.
- `data/accounts.json`: dữ liệu demo tài khoản/nhân vật được tạo khi server chạy.

## Chạy trên máy chủ
```bash
npm install
npm start
```

Mở `http://localhost:3000`.

## Nguyên tắc chống cheat
Client chỉ gửi input điều khiển. Server:
- giới hạn tốc độ và tần suất gói tin;
- giới hạn tọa độ trong world;
- tự tính vị trí;
- giữ HP/MP/vàng/túi ở phía server;
- lưu dữ liệu khi người chơi ngắt kết nối.

Đây là khung demo, chưa phải backend production. Khi triển khai thật nên thêm đăng nhập bằng token, TLS/WSS, database, rate limit theo IP/tài khoản, log/audit, kiểm tra giao dịch và chống replay.

## 4.11.1
- WebSocket server-authoritative movement.
- Snapshot 10 lần/giây.
- Đồng bộ nhiều người chơi: tên, cấp, môn phái, Ngũ hành, ngựa, phi phong.
- Client chỉ gửi input; server giữ tọa độ chính.
- Heartbeat ping/pong và giới hạn tốc độ gói input.
