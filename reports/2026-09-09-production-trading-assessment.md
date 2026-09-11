# Đánh giá AI trader bằng dữ liệu production — 09/09/2026

## Kết luận

**Chưa đáp ứng mục tiêu AI tự phân tích và giao dịch như trader chuyên nghiệp; chưa có bằng chứng để tăng vốn live.** Hệ thống có nền tảng kiểm soát và thực thi, nhưng hoạt động analyst gần đây chủ yếu là quy tắc, dữ liệu bổ trợ thiếu, kết quả demo quan sát được âm và công cụ đánh giá chưa đo đúng hiệu quả của AI theo đường chạy thực tế.

Đây không phải kết luận hệ thống không thể cải thiện hoặc mọi phiên bản đều thua. Giao dịch đã đóng thuộc giai đoạn cũ, số mẫu nhỏ, có lệnh imported; chưa xác minh commit triển khai hoặc quy toàn bộ giao dịch cho pipeline tự động.

## Phạm vi và nguồn bằng chứng

- Mã nguồn local: `a4e4b7792bbe863a487a5497a88996b3422c829d`.
- Truy cập database được cấu hình trong `.env`, được dùng làm nguồn production cho đánh giá này. PostgreSQL xác nhận `transaction_read_only=on`; thời gian server lần đầu: `2026-09-09T07:51:31.081Z`, tức 14:51 giờ Việt Nam.
- Mỗi SELECT chạy trong transaction READ ONLY, statement timeout 15 giây. Các lượt đọc cách nhau vài phút; không phải một snapshot bất biến duy nhất.
- Đã đọc thống kê analyst/pipeline, kết quả đánh giá tín hiệu, ledger/fills, coverage account snapshots và nến đóng. Không đặt lệnh, không kích hoạt pipeline, không ghi database, không sửa cấu hình giao dịch.
- Cổng DB hiện kết nối được. SSH với hai khóa GCP có sẵn vẫn bị từ chối publickey; chưa kiểm tra được image/commit thực tế trên VM. Kết quả này cập nhật hạn chế kết nối trong báo cáo trước.
- [Số liệu tổng hợp](2026-09-09-production-trading-evidence.json) và [SQL tái kiểm tra](2026-09-09-production-trading-audit.sql). Không lưu credentials, user ID, connection ID hay nội dung tài khoản cá nhân vào các artifact này.

## 1. AI có thực sự phân tích không?

Trong cửa sổ 7 ngày trước thời điểm trích xuất:

- 12.985 lượt analyst COMPLETED ghi provider `DETERMINISTIC`; một lượt On-chain COMPLETED không ghi provider. Không thấy lượt GEMINI/LLM trong bảng `agent_runs` ở cửa sổ này.
- Market: 2.479 lượt deterministic; Technical: 2.476; News: 2.476; Sentiment: 2.475; On-chain: 2.464; Macro: 615.
- Market/Technical từng dùng GEMINI, nhưng lượt cuối cùng được ghi nhận khoảng 02:53 UTC ngày 27/08.

Điều này phù hợp với `agent-runner.service.ts:484`: nếu `buildDeterministicOutput` trả kết quả, runner bỏ qua AI orchestrator, ghi token/cost bằng 0. Không suy rộng rằng mọi module khác của ứng dụng đều không dùng LLM.

**So với mục tiêu của bạn:** hệ thống hiện có nhiều vai trò analyst, nhưng chưa thể hiện việc AI liên tục xây dựng luận điểm, phản biện, cập nhật kịch bản và chọn setup bằng suy luận. Việc bật LLM trở lại cũng chưa tự tạo lợi thế: phải đo phần đóng góp thêm so với baseline quy tắc.

## 2. Giao dịch thực tế trong database đang thế nào?

Toàn bộ 32 bản ghi `closed_trades` và 169 fills quan sát được thuộc **OKX DEMO**, trên một connection, từ 21/08 đến 02/09. Không thấy LIVE trong hai bảng này. 255.735 account snapshots cũng mang nhãn DEMO; không diễn giải số lượng snapshot thành số phiên giao dịch độc lập.

| Tập quan sát | Số lượng | Thắng | Net PnL ledger (USDT) | Profit Factor |
|---|---:|---:|---:|---:|
| Bản ghi đóng lệnh | 32 | 13/32 = 40,63% | −40,3465 | 0,5226 |
| Gộp theo chu kỳ bằng hàm nguồn | 24 | 9/24 = 37,50% | −40,3465 | 0,5222 |
| Chu kỳ có `sourceDataComplete=true` | 22 | 9/22 = 40,91% | −24,0105 | 0,6474 |

Gộp bằng `aggregateClosedTradeCycles` của repository: connection + strategy + symbol + side + openedAt. Đây là proxy chu kỳ theo logic hiện hành, chưa phải đối soát độc lập từng vòng vị thế với exchange.

Gross PnL là −19,8217 USDT, signed fees −20,5249 USDT, net −40,3465 USDT. Tổng realized PnL và fees của fills khớp tổng ledger; từng dòng cũng khớp `gross + fee = net` trong sai số số học. Đây là đối soát nội bộ database, chưa đối soát statement trực tiếp từ sàn hoặc funding/cash flows. Funding không có trong phép tính `netPnl = grossPnl + fee` tại `exchange-trade-ledger.service.ts:183`.

Có 13 bản ghi `IMPORTED`, 7 `TAKE_PROFIT`, 12 `STOP_LOSS`; 19/32 có strategyId. Vì vậy không quy toàn bộ số lỗ này cho phiên bản AI hiện tại. Nhưng ngay cả tập có provenance đầy đủ theo cờ của hệ thống cũng **chưa cho thấy lợi thế dương**. Số mẫu chưa đủ để ước lượng chắc chắn hiệu quả dài hạn.

## 3. Pipeline đang giao dịch hay đứng ngoài?

Trong cửa sổ 7 ngày: **3.616/3.616 pipeline runs ghi quyết định cuối là WAIT**. Toàn bộ cửa sổ khoảng 30 ngày có dữ liệu từ 25/08: 100 LONG, 72 SHORT; quyết định directional cuối được ghi nhận ngày 02/09 lúc 01:39 UTC.

Các lý do WAIT phổ biến, nhóm theo trường reason/skippedReason đã lưu:

| Lý do | Số lượt |
|---|---:|
| DECISION_IS_WAIT | 1.644 |
| NO_TRADE_ZONE | 599 |
| EXPECTED_VALUE_NEGATIVE | 244 |
| STALE_MARKET_DATA:5m,15m,1h | 215 |
| STALE_MARKET_DATA:5m,15m | 213 |
| PARTIAL_DATA_CONVICTION_TOO_LOW | 200 |
| CALIBRATED_PROBABILITY_TOO_LOW | 190 |
| CONFIDENCE_BELOW_THRESHOLD | 142 |

Đây là top lý do, không phải phân rã toàn bộ nguyên nhân gốc. `DECISION_IS_WAIT` chỉ là kết quả trung gian; cần trace đầy đủ để biết vì sao Decision chọn WAIT. 1.135 bộ step còn PENDING có thể thuộc nhánh dừng sớm; chưa đủ bằng chứng gọi là queue bị treo.

WAIT không phải lỗi nếu không có setup đạt yêu cầu. **Không nên hạ gate chỉ để hệ thống có lệnh.** Tuy nhiên, dữ liệu production cho thấy cần xử lý nguồn dữ liệu trước:

- On-chain: 1.969 lượt COMPLETED nhưng output `INSUFFICIENT`, 495 `PARTIAL`, một output không ghi quality; không có GOOD trong mẫu này.
- Sentiment: 2.470 `PARTIAL`, 5 `INSUFFICIENT`; không có GOOD.
- Market: 1.210 `PARTIAL`, 1.269 `GOOD`.
- Technical: 2.476 `GOOD`, nhưng cờ này không xác nhận phương pháp phân tích đúng về chuyên môn.

## 4. Tín hiệu có lợi thế không?

Lọc `performance_records`: horizon MID = 1 giờ, provenanceEligible=true, decision LONG/SHORT. Có **2.634 đánh giá**, tỷ lệ return dương **37,97%**, return trung bình **−0,12385% mỗi đánh giá**.

Điểm quan trọng: **2.570/2.634** thuộc pipeline có quyết định cuối WAIT. `PerformanceService` ưu tiên đánh giá candidate từ storedContext, nên số liệu này phần lớn là tín hiệu ứng viên, không phải lệnh đã đặt. Tập 64 đánh giá có quyết định cuối directional có 16 return dương, trung bình −0,39023%; vẫn không chứng minh đã khớp lệnh.

Kiểm tra độ nhạy bằng cách chỉ giữ tín hiệu đầu tiên mỗi symbol rồi bỏ các tín hiệu cùng symbol cho đến actualTargetTimestamp: còn **652** mẫu, return dương **42,64%**, trung bình **−0,08820%**. Cách này giảm chồng lấn một giờ trên cùng symbol, nhưng chưa loại tương quan giữa coin/ngày/regime. Không tính khoảng tin cậy giả định mọi tín hiệu độc lập.

Trong 7 ngày gần nhất, 737 đánh giá MID directional có return dương 44,10%, trung bình −0,12058%. Không xem đó là PnL của một hệ thống đang WAIT.

Confidence cũng chưa thể hiểu là xác suất thắng: nhóm score 70–79 có 1.802 đánh giá, chỉ 36,29% return dương; nhóm 80–100 có 99 đánh giá, 38,38% return dương. Đây là mô tả composite score với endpoint outcome, không phải phép đo sai số của một xác suất calibrated.

Không cộng return của các đánh giá thành ROI tài khoản. Horizon khác có thể cho kết quả khác: LONG/24 giờ trong tập provenance=true có mean return dương ở cả LONG và SHORT. Điều đó không đủ để chọn chiến lược giữ 24 giờ sau khi nhìn dữ liệu; cần holdout riêng và mô phỏng đường thoát lệnh.

## 5. Thử nghiệm cục bộ với nến production

Đã lấy 1.741 nến 15 phút mỗi symbol BTC-USDT và ETH-USDT, từ 22/08 03:45 UTC đến 09/09 07:44:59 UTC. Mỗi bộ thiếu 3 nến ở 3 khoảng; không có OHLC sai thứ tự high/low/open/close. Không tự điền nến thiếu.

Chạy trực tiếp `runHistoricalBacktest` từ mã TypeScript hiện tại, ngoài ứng dụng, không kết nối execution. Tham số đặt trước cho chẩn đoán: balance 10.000, leverage 1, riskPerTrade 1%, RR 2, fee mỗi chiều 0,05%, slippage mỗi chiều 0,02%, các tham số còn lại dùng mặc định nguồn.

| Symbol | Số trade mô phỏng | Return simulator | PF | Return khi phí và slippage gấp đôi |
|---|---:|---:|---:|---:|
| BTC-USDT | 145 | −22,60% | 0,394 | −36,85% |
| ETH-USDT | 158 | −21,15% | 0,553 | −36,83% |

**Giới hạn quyết định:** đây là kết quả simulator hiện hành trên dữ liệu thật, không phải replay AI production hoặc dự báo mức lỗ live. Không dùng bảng này để xếp hạng chiến lược hay chọn tham số. Nến thiếu có thể làm sai đường SL/TP; simulator chưa tái hiện funding, latency, fill/gap và Position Manager như thực tế.

Trên cả hai symbol, `HYBRID_AI`, `PREVIOUS_AI_VERSION`, `PREVIOUS_STABLE_RELEASE` có **toàn bộ danh sách trade giống hệt nhau**. Mã nguồn `backtest-engine.ts:258` cho cả ba dùng cùng nhánh trend/RSI/volume. Benchmark này không đo cải tiến của AI giữa các phiên bản.

## 6. Những khoảng cách chuyên môn cần sửa

1. **Phân tích kỹ thuật có bằng chứng thật.** `deterministic-core-analysis.ts:241` gán HH_HL/LH_LL theo trend; `:281` ước lượng RSI trước bằng RSI hiện tại ±10 dựa vào MACD hiện tại. Chưa phải phân kỳ giữa oscillator lịch sử tại hai pivot. Long wick cũng có thể được gắn nhãn sweep mà không cần quét mức giá trước. Cần chuỗi chỉ báo, pivot đã xác nhận theo thời gian, mức bị quét và điều kiện reclaim; thiếu dữ liệu phải trả UNKNOWN/UNAVAILABLE phù hợp.
2. **Đo đúng outcome và EV.** `decision.service.ts:851` suy expectedReward/Loss từ opportunityScore, chưa từ entry/TP/SL và payoff thực tế. Có ngoại lệ strong cold-start giữ EV/PF này. Query calibration tại `:455` chưa lọc provenanceEligible. Endpoint return tại `performance-calculator.ts:5` không tái hiện chạm SL rồi hồi về cuối giờ. Sửa đơn vị EV về R, phí/slippage/funding về cùng đơn vị và calibration theo đúng chính sách vào/thoát.
3. **Kịch bản thực thi được.** `decision.service.ts:932` truyền currentPrice/ATR/support/resistance là undefined vào blueprint. Cần gắn một snapshot giá cụ thể, trigger, invalidation, thời hạn và điều kiện tái đánh giá. Trade Plan riêng vẫn có thể tạo SL/TP; phát hiện này không đồng nghĩa lệnh không có bảo vệ.
4. **Đánh giá lại benchmark và metrics.** Dùng cùng Decision → Judge → Risk → Position Manager theo dữ liệu đúng thời điểm, entry sau khi biết tín hiệu; xử lý SL/TP cùng nến thận trọng, phí và funding. `annualizedReturn=totalReturn*12`, `monthlyReturn=totalReturn`, tần suất chia số trade cho số điểm equity theo trade chưa phải các metrics đúng theo thời gian.
5. **AI đưa luận điểm, code giữ quyền thực thi.** AI cần giải thích regime, setup, bằng chứng trái chiều, trigger, invalidation và WAIT. Judge phản biện dựa vào cùng snapshot; sizing, giới hạn tổn thất và quyền gửi lệnh vẫn do code xác định kiểm soát. Nhiều analyst cùng đọc EMA không phải nhiều bằng chứng độc lập.

## 7. Thứ tự cải thiện và tiêu chuẩn quyết định

**Ưu tiên 1 — đo đúng và sửa dữ liệu:** hoàn chỉnh ledger/funding, định danh chu kỳ, provenance/version, outcome theo trade plan; điều tra stale candles và nguồn On-chain/Sentiment. Sửa divergence/structure để không đưa nhãn vượt quá bằng chứng.

**Ưu tiên 2 — thử AI ở chế độ shadow:** cùng snapshot, chạy rules-only và AI có luận điểm; lưu model/prompt/config, bằng chứng, trigger, kế hoạch và latency/cost. Đo phần đóng góp bằng bỏ từng analyst; không cấp quyền vào lệnh chỉ vì AI viết phân tích thuyết phục.

**Ưu tiên 3 — kiểm định trước khi live:** replay đúng chính sách execution, chia holdout theo thời gian, chống nhìn trước và chồng lấn nhãn, forward shadow; đánh giá expectancy sau chi phí, drawdown mark-to-market, độ nhạy phí/slippage và ổn định giữa regime. Đặt tiêu chuẩn chấp nhận trước khi xem holdout; dùng mức bất định và tương quan để quyết định cỡ mẫu.

Hiện tại phù hợp tiếp tục phát triển và thu thập bằng chứng trên DEMO/shadow. **Chưa có cơ sở mở rộng vốn live, tăng leverage hoặc nới gate để ép vào lệnh.** Không có trader hay AI bảo đảm lợi nhuận mọi tình huống; mục tiêu thực tế là lợi thế dài hạn sau chi phí và kiểm soát tổn thất. Tham khảo [CFTC về giới hạn của AI trading bots](https://www.cftc.gov/LearnAndProtect/AdvisoriesAndArticles/AITradingBots.html).

## Kiểm chứng kỹ thuật

Đã chạy 6 file Vitest, **72/72 tests đạt**: Decision, data quality, Judge, Risk Engine, benchmark/replay execution, performance calculator. Tests dùng fixture; không phải bằng chứng profitability. Thử nghiệm nến production và kiểm tra ledger ở trên chạy riêng, trực tiếp hàm nguồn. Không thay đổi mã nguồn giao dịch.
