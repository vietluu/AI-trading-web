# Đánh giá bản build hiện tại bằng pipeline từ 05/09/2026

## Kết luận

**Bản hiện tại chưa thể vào lệnh LIVE và PnL LIVE dự kiến theo đúng cấu hình đang chạy là 0.** Đây là kết luận về khả năng thực thi, không phải dự báo thị trường:

- `.env` đang đặt `TRADING_MODE=DEMO`, `LIVE_TRADING_ENABLED=false` và `EXCHANGE_PRODUCTION_CONNECTIONS_ENABLED=false`.
- Database chỉ có một kết nối `OKX_FUTURES / DEMO`; kết nối này enabled và verified, nhưng không phải production connection.
- `self_learning_configurations` chưa có `approvedVersion` và `approvedConfigurationHash`. Khi mode là LIVE, `live-trading.service.ts` sẽ chặn bằng `STRATEGY_VERSION_NOT_APPROVED_FOR_LIVE`.
- Replay 1.880 pipeline context bằng Decision, strategy arbitration, calibration, Risk Policy, Judge, multi-timeframe và Quant Policy của commit local `d64a7c69769d20b8ecf5d7da340b5053a242b0b1` không tạo candidate nào vượt toàn bộ gate khi Quant chạy ở mode LIVE.

Do đó, việc chỉ chuyển công tắc sang LIVE sẽ không làm hệ thống vào lệnh. Cần một production exchange connection, phiên bản chiến lược được phê duyệt và bằng chứng Quant khớp đúng risk assumptions.

## Phạm vi dữ liệu

- Mốc bắt đầu: `2026-09-04T17:00:00Z`, tương ứng 00:00 ngày 05/09 tại Việt Nam.
- 2.439 pipeline runs được đọc bằng transaction READ ONLY; 1.880 run có đủ `analyses` và `fusionOutput` để replay Decision.
- Replay dùng mã local hiện tại và chỉ dùng performance/validation/regime có timestamp không muộn hơn từng run để giảm look-ahead.
- LLM Reflection không được gọi lại trong replay vì output LLM không tất định. Các Reflection đã thực sự chạy trên production được phân tích riêng.
- Không gửi lệnh, không kích hoạt pipeline và không ghi database.

Chưa xác minh commit/image thực tế trên VM vì SSH key local bị từ chối. Tuy vậy database xác nhận tính năng LLM Reflection mới đã hoạt động trên production từ sáng 09/09.

## Replay gate của bản hiện tại

Kết quả phân loại 1.880 context:

| Kết quả/gate chính | Số run |
|---|---:|
| Decision tự chọn WAIT | 735 |
| Calibration probability quá thấp | 319 |
| Quant assumptions không khớp risk config | 310 |
| Partial data chưa calibrated | 150 |
| Expected value không đạt | 152 |
| Confidence không đạt | 72 |
| Quant regime conflict | 61 |
| Partial data conviction thấp | 63 |
| Quant validation thiếu | 18 |

Các nhóm trên là lý do đầu tiên của candidate được chọn trong replay, không nhất thiết loại trừ lẫn nhau về nguyên nhân sâu. Tổng bằng 1.880 và không có `ACTIONABLE` ở mode LIVE.

Kết quả này giải thích vì sao hệ thống có thể vẫn không vào lệnh sau khi các lỗi kỹ thuật đã được sửa: phần còn lại chủ yếu là gate mô hình/calibration/Quant và phê duyệt LIVE, không chỉ là lỗi runtime.

## AI mới đang tham gia ở đâu?

Nhận định “toàn bộ hệ thống gần đây chỉ deterministic” cần được sửa lại:

- Market, Technical, News, Sentiment, Macro và On-chain analyst gần đây vẫn tạo output deterministic.
- Bản mới có `ChainOfThoughtReflectionService` chạy LLM sau Decision cho candidate khác WAIT.
- Database ghi 11 AI histories liên quan Reflection trong ngày 09/09: 8 thành công và 3 thất bại. Sáu pipeline runs đã lưu reflection trong `result` tại thời điểm trích xuất.
- Một ví dụ mới nhất: Decision ban đầu có xu hướng LONG, nhưng Reflection đánh giá trap probability 75% và chuyển thành WAIT.

Điểm tốt là AI đang đóng vai trò phản biện cuối. Tuy nhiên LLM chỉ có quyền giảm confidence hoặc chuyển WAIT; nó chưa chứng minh khả năng tạo entry có expectancy dương. Prompt yêu cầu “chain-of-thought” và lưu reasoning chi tiết cũng cần được xem xét lại về tính ổn định, khả năng audit và dữ liệu nhạy cảm.

## Shadow version 343 — bằng chứng gần bản mới nhất

`paper_signals` là nguồn gần logic mới hơn closed trade cũ. Version 343 bắt đầu lúc `2026-09-08T20:46:29Z`.

Tại thời điểm đọc:

| Chỉ số | Giá trị |
|---|---:|
| Tín hiệu đã có outcome | 183 |
| Correct | 79 |
| Win rate endpoint | 43,17% |
| Tổng return quan sát | −6,6598 điểm % |
| Mean return mỗi tín hiệu | −0,03639% |
| Profit Factor | 0,8810 |
| Đang chờ đánh giá | 11 |

Đây là return từ giá tham chiếu đến giá đóng cửa sau đúng một giờ, đã trừ 0,1 điểm % chi phí cố định. Nó không mô phỏng entry fill, SL/TP, partial take-profit, trailing stop, funding, giới hạn vị thế hoặc tổng exposure. Do đó không được gọi là PnL tài khoản.

`shadowPerformance` trong configuration hiển thị 141 trades, totalReturn +3,7066 và PF 1,0922, nhưng truy vấn trực tiếp version 343 đã có 183 outcome và tổng −6,6598. Khác biệt có thể do thời điểm cập nhật trường tổng hợp hoặc batch evaluator. Dashboard/config aggregate không nên dùng làm nguồn quyết định nếu chưa đối soát với rows cùng timestamp.

## Ước tính PnL và độ nhạy

Để minh họa độ bất định, quy đổi version 343 theo tài khoản giả định 10.000 USDT và mỗi tín hiệu dùng 40% equity:

| Cách xử lý tín hiệu | Mẫu | PF | PnL quy đổi |
|---|---:|---:|---:|
| Cộng cả 183 tín hiệu như độc lập | 183 | 0,881 | khoảng −266 USDT |
| Bỏ tín hiệu cùng symbol trong vòng 1 giờ | 47 | 1,006 | khoảng +0,65 USDT |
| Chỉ giữ tín hiệu đầu tiên toàn hệ thống mỗi giờ | 13 | 2,196 | khoảng +211,67 USDT |

Ba kết quả đổi dấu chỉ vì quy tắc xử lý tín hiệu đồng thời. Kịch bản cuối còn phụ thuộc thứ tự run và có 13 mẫu, nên không phải dự báo lợi nhuận. Con số −266 USDT cũng giả định có thể thực thi mọi tín hiệu chồng lấn, trái với giới hạn exposure/position.

Vì vậy khoảng hợp lý duy nhất có thể kết luận lúc này là: **PnL LIVE theo cấu hình thật = 0; PnL phản thực tế của candidate mới chưa ước lượng đáng tin cậy.** Shadow version 343 hiện ở vùng hòa vốn đến âm nhẹ sau khi giảm chồng lấn theo symbol, chưa cho thấy edge đủ mạnh.

## Đánh giá hệ thống hiện tại

So với trạng thái trước, hệ thống đã cải thiện ở strategy arbitration, LLM Reflection, stale-data handling, multi-timeframe gate, risk sizing và deployment image pinning. Kiến trúc có nhiều lớp bảo vệ và không ép giao dịch khi dữ liệu yếu.

Các vấn đề còn quyết định khả năng hoạt động:

1. **LIVE bị khóa đúng theo thiết kế.** Thiếu production connection và phê duyệt strategy version.
2. **Quant validation không đồng bộ với risk config.** 310 replay candidates bị `QUANT_ASSUMPTION_MISMATCH`; cần tạo lại validation với leverage/risk/RR đúng cấu hình dự định chạy.
3. **Calibration chưa chứng minh edge.** 319 candidate bị probability thấp. Không nên nới threshold trước khi sửa cách đo outcome theo trade plan.
4. **Shadow evaluator chưa mô phỏng execution.** Outcome một giờ không trả lời lệnh chạm SL hay TP trước, và không áp dụng Position Manager.
5. **Dữ liệu phụ trợ vẫn yếu.** On-chain phần lớn insufficient và Sentiment chủ yếu partial, khiến hệ thống phụ thuộc mạnh vào Market + Technical.
6. **LLM Reflection mới có rất ít mẫu.** Tám lượt thành công chưa đủ đo lift; ba lượt thất bại cho thấy cần theo dõi fallback, latency và tỷ lệ override đúng/sai.

## Điều kiện để có kết luận go-live

1. Sinh lại Quant validation với đúng risk assumptions của cấu hình LIVE dự kiến.
2. Chạy shadow cùng Decision → Judge → Risk → trade plan → Position Manager, xử lý concurrency và toàn bộ chi phí.
3. Đối soát aggregate shadow với rows theo một timestamp nhất quán.
4. So sánh rules-only với rules + LLM Reflection trên cùng candidate; đo Reflection tránh được bao nhiêu loss và bỏ lỡ bao nhiêu win.
5. Chỉ phê duyệt `approvedVersion/configurationHash` khi phiên bản đạt tiêu chuẩn đặt trước trên holdout/forward shadow.
6. Sau đó mới cấu hình production connection và bật LIVE với risk nhỏ; việc bật LIVE là hành động vận hành riêng, không nằm trong đánh giá này.

Kết luận go/no-go hiện tại: **NO-GO cho LIVE; tiếp tục DEMO/shadow.**
