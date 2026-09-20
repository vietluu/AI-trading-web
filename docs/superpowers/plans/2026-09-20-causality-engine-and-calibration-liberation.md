# Plan Ngày 20/09: Giải Phóng Tê Liệt Calibration & Kích Hoạt Động Cơ Phân Tích Động Lực (Causality Engine)

> **Mục tiêu:** 
> 1. Phá bỏ "Vòng lặp tự khóa" (Calibration Deadlock) đang ép 100% quyết định thành `WAIT` trong ngày 20/09 do dữ liệu 38 lệnh lỗi thời kỳ trước.
> 2. Kích hoạt Động cơ phân tích động lực tăng giá (Causality Engine: Volume Ratio, Delta OI, Squeeze Detection) và trao quyền phán đoán Breakout cho AI.
> 3. Triển khai trọn vẹn lên máy chủ Production GCP VM (`35.247.72.125`).

---

## 1. Vấn đề Phát hiện trên Production ngày 20/09

### A. Vòng lặp tự khóa (Calibration Deadlock) trong `decision.service.ts`
- **Dữ liệu thực tế ngày 20/09:** 
  - AI phân tích `SOL-USDT` cho ra kết quả cực mạnh: Bearish bias -100, 100% đồng thuận giữa các agent, Confidence = 85.
  - Nhưng kết quả cuối cùng vẫn bị biến thành `WAIT`!
- **Nguyên nhân gốc rễ:**
  - `decision.service.ts` (dòng 227-243) kiểm tra `empiricalProbability`:
    ```typescript
    if (empiricalProbability !== undefined && empiricalProbability < 0.35) {
      calibrationBlockingReasons.push('CALIBRATED_PROBABILITY_TOO_LOW');
      finalConfidence = Math.min(finalConfidence, 40);
    }
    if (finalConfidence <= 40 && decision.decision !== "WAIT") {
      finalDecisionAction = "WAIT";
    }
    ```
  - `empiricalProbability` hiện tại là **0.3125 (31.25%)**, được tính từ **38 lệnh cũ** trong quá khứ bị dính lỗi Stop Loss 0.03%.
  - Vì 38 lệnh cũ thua, hệ thống phạt điểm tin cậy của mọi cơ hội mới xuống 40, và ép mọi lệnh thành `WAIT`.
  - **Hệ quả:** Hệ thống rơi vào vòng lặp chết: Không có lệnh mới nào được vào $\rightarrow$ Win rate không thể cải thiện $\rightarrow$ Hệ thống bị đóng băng vĩnh viễn ở `WAIT`.

### B. Thiếu hụt chỉ số động lực (Causality Metrics)
- AI chưa được cung cấp `volumeRatio`, `deltaOi`, `squeezeIndicator` để giải thích lý do tại sao giá tăng.
- Bộ lọc `isMomentumExhausted` vẫn chặn `WAIT` khi RSI > 75 kể cả khi volume bùng nổ.

---

## 2. Các Bước Thực Hiện Chi Tiết

### Task 1: Phá bỏ Vòng lặp tự khóa Calibration trong `decision.service.ts`
- **File:** `apps/api/src/modules/agents/application/services/decision.service.ts`
- **Thay đổi:**
  - Không được dùng `empiricalProbability` từ mẫu fallback toàn cục (`fallbackUsed === true` hoặc `hardGateEligible === false`) để hạ confidence xuống $\le 40$ và ép `WAIT`.
  - Chỉ áp dụng hard blocking khi có mẫu kiểm chuẩn chính xác (`scope === 'EXACT' && !fallbackUsed`).
  - Đối với các cơ hội có conviction mạnh (confidence $\ge 80$, directional agreement $\ge 80\%$), cho phép thi hành với `riskTier = 'PROBE'` (size 0.25x - 0.5x) để hệ thống có cơ hội tạo ra các lệnh mới kiểm chứng bản sửa lỗi, thay vì bị triệt tiêu hoàn toàn.

### Task 2: Cập nhật Judge Agent trong `decision-judge.service.ts`
- **File:** `apps/api/src/modules/pipeline/application/decision-judge.service.ts`
- **Thay đổi:**
  - Đảm bảo Judge Agent không biến các cơ hội probe thành `REQUEST_MORE_DATA` khi calibration chỉ là global fallback.

### Task 3: Bổ sung Causality Metrics trong `market-tools.ts`
- **File:** `apps/api/src/modules/ai-tools/infrastructure/tools/market-tools.ts`
- **Thay đổi:**
  - Bổ sung `volumeRatio = volume / avgVolume20`.
  - Bổ sung `deltaOi` và `squeezeIndicator` khi giá tăng đột biến với funding âm.

### Task 4: Gỡ bỏ rào cản RSI tĩnh trong `strategy-decision.ts`
- **File:** `apps/api/src/modules/portfolio/domain/strategy-decision.ts`
- **Thay đổi:**
  - Cho phép `isMomentumExhausted` trả về `false` khi có `volumeRatio >= 1.35` hoặc cấu trúc `BREAKOUT` / `HH_HL`.

### Task 5: Kiểm thử toàn diện & Triển khai
- Chạy unit tests cho `decision.service.spec.ts`, `decision-judge.service.spec.ts`.
- Chạy toàn bộ test suite `@platform/api` (1,294 tests).
- Chạy `pnpm typecheck`.
- Tạo Pull Request #109, merge vào `main` để kích hoạt workflow deploy lên GCP VM.
