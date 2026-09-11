# Đánh giá AI trader — 09/09/2026

> Cập nhật cùng ngày: lần kiểm tra tiếp theo đã đọc được database production bằng READ ONLY và chạy thử nghiệm cục bộ trên nến thật. Xem [báo cáo production mới](2026-09-09-production-trading-assessment.md), thay thế hạn chế chưa kết nối được và bổ sung bằng chứng thực tế cho báo cáo lịch sử bên dưới.

## Kết luận và phạm vi

Hệ thống có nền tảng execution và quản trị rủi ro đáng kể, nhưng mã nguồn hiện tại chưa đáp ứng đầy đủ mục tiêu AI tự suy luận như trader chuyên nghiệp. Chưa có bằng chứng trong lần đánh giá này để kết luận hệ thống có lợi thế giao dịch sau mọi chi phí hoặc nên tăng vốn live.

Đã kiểm tra commit local `6d5a7a373b4a070bf272bee702eb6447f208e80b`. Chưa xác minh commit đang chạy trên production. Không sửa logic giao dịch, không đặt lệnh, không gọi API kích hoạt pipeline, không ghi database.

Production: đã lấy DATABASE_URL trực tiếp từ `.env`; `.env` và `apps/api/.env.local` cùng trỏ đến một host/database. Prisma không kết nối được. Kiểm tra TCP tiếp theo xác nhận cổng 5432 trả `Connection refused`, cổng SSH 22 truy cập được. Các lần SSH bằng khóa GCP hiện có bị từ chối `publickey`. Vì vậy chưa đọc được giao dịch, tín hiệu, nến hoặc PnL production. Đây là hạn chế kết nối; không chứng minh database mất dữ liệu hay hệ thống đang ngừng hoạt động. Compose trong repository bind PostgreSQL vào `127.0.0.1:5432`, phù hợp với khả năng cần SSH tunnel, nhưng chưa xác minh cấu hình thực tế trên máy chủ.

## Những điểm hệ thống đã có

- Phân tách analyst, Decision, Judge, Risk và execution; có WAIT và kiểm tra chất lượng/độ mới dữ liệu.
- Trade Plan theo regime, ATR, hỗ trợ/kháng cự, vị trí entry và reward/risk sau chi phí.
- Risk Engine giới hạn drawdown, exposure, risk per trade và leverage.
- Position Manager có break-even, partial profit và trailing stop.
- Có ledger từ exchange fills, thông tin phí mở/đóng và đánh dấu dữ liệu đầy đủ; có reflection, calibration và nghiên cứu chiến lược.

Các thành phần này là nền tảng tốt, nhưng sự tồn tại của chúng không tự chứng minh lợi nhuận hoặc việc chúng đang được cấu hình đúng trên production.

## Các khoảng cách quan trọng

### 1. LLM không phải lõi suy luận ở đường chạy đủ dữ liệu

`apps/api/src/modules/agents/application/runners/agent-runner.service.ts:484` gọi `buildDeterministicOutput` trước. Nếu trả kết quả, runner ghi provider `DETERMINISTIC`, token/cost bằng 0 và không gọi AI orchestrator. Sáu analyst Market, Technical, News, Sentiment, Macro, On-chain đều khai báo builder này. Một số builder có thể trả undefined để đi tiếp sang LLM, nên không thể kết luận toàn hệ thống tuyệt đối không dùng AI.

`DecisionService.decide` tổng hợp bias, trọng số, bonus và penalty bằng quy tắc. Có nhiều agent không đồng nghĩa nhiều nguồn suy luận độc lập: Market và Technical cùng dùng EMA/chỉ báo giá, rồi được cộng bonus đồng thuận. Cần đo tương quan và đóng góp bổ sung thực sự bằng ablation.

Nếu mục tiêu là AI suy luận, cần một lớp đề xuất luận điểm có bằng chứng: trạng thái thị trường, setup, trigger vào lệnh, invalidation, kịch bản thay thế, thời hạn và điều kiện WAIT. Giữ tính toán chỉ báo, sizing và quyền đặt lệnh trong code xác định. Chỉ đưa LLM vào execution sau khi chứng minh lợi ích so với baseline quy tắc trên cùng dữ liệu và chi phí.

### 2. Một số nhãn phân tích kỹ thuật sâu đang là phép gần đúng

`deterministic-core-analysis.ts` suy ra HH_HL/LH_LL từ hướng EMA, chưa xác nhận chuỗi swing high/low tại đoạn tính này. RSI divergence dùng `estimatedFirstRsi = rsi hiện tại ± 10` theo dấu MACD histogram hiện tại; MACD divergence dùng dấu histogram hiện tại cùng thay đổi cực trị giá. Đây không phải đối chiếu oscillator lịch sử tại hai pivot tương ứng. MACD crossover trả `NONE` trong output xác định.

Hệ quả: nhãn “divergence” hoặc “market structure” có thể tạo cảm giác bằng chứng mạnh hơn dữ liệu thực có. Nên tính chuỗi oscillator lịch sử, xác nhận pivot không nhìn trước tương lai, kiểm tra độ cách xa/thời gian giữa pivot, và dùng UNKNOWN/UNAVAILABLE khi thiếu dữ liệu. Không tự động coi râu nến dài là sweep có xác nhận.

### 3. Confidence, xác suất thắng và EV chưa cùng đo một đối tượng

`decision.service.ts:771` đặt prior xác suất thắng 0.5; reward/loss suy ra từ opportunityScore. Ví dụ score 80 cho expectedReward=2.9, expectedLoss=0.68, EV trước phí=1.11 và PF ước tính≈4.26 dù chưa có lịch sử thắng thua. Các giá trị này chưa gắn trực tiếp vào entry/TP/SL và phân phối payout thực tế.

Calibration truy vấn `performance_records`, còn `evaluateDecision` đánh giá giá tại thời điểm đầu/cuối horizon, trừ chi phí cố định (mặc định caller 0.1 điểm phần trăm). Nó không mô phỏng đường giá chạm SL/TP, partial profit hay trailing. Xác suất “đúng hướng sau 1 giờ” không thể dùng nguyên trạng làm xác suất “lệnh theo trade plan có lãi”. Query calibration cũng chưa lọc `provenanceEligible` tại đoạn đọc đã kiểm tra.

Có ngoại lệ cold start giữ EV/PF từ score khi conviction mạnh; Judge với `requireCalibratedConfidence` vẫn có nhánh cho phép dữ liệu chưa calibrated nếu confidence đủ cao. Do đó tên cờ này không có nghĩa mọi lệnh đều có bằng chứng thống kê.

Ưu tiên: tách score khỏi probability, hiệu chỉnh bằng kết quả lệnh hoặc mô phỏng cùng chính sách thoát, tính EV theo cùng đơn vị R và chi phí, phân cohort theo chiến lược/regime/phiên bản. Khi chưa có bằng chứng, thu thập kết quả qua shadow/demo với ngân sách thử nghiệm riêng thay vì coi conviction là edge đã được xác nhận.

### 4. Backtest chưa tái hiện AI và execution thực tế

`backtest-engine.ts` dùng cùng nhánh giá/RSI/volume cho HYBRID_AI, PREVIOUS_AI_VERSION và PREVIOUS_STABLE_RELEASE. Không có replay output AI, prompt/model/config tương ứng trong nhánh này. EMA_CROSS, SMA_CROSS, MACD_TREND và SUPERTREND cũng dùng chung giao cắt trung bình số học 10/30 tại đây.

Backtest có phí/slippage, nhưng stop dùng volatility lợi suất close, phần lớn chiến lược giữ tối đa 8 bar, không gọi Trade Plan/Position Manager như live và không có funding trong phép tính PnL này. BUY_AND_HOLD cũng chạy qua stop/target/sizing chung nên không phải benchmark mua rồi giữ thuần túy.

Một số metrics có lỗi định nghĩa: annualizedReturn=totalReturn×12 bất kể thời gian dữ liệu; monthlyReturn=totalReturn; equityCurve có một điểm mỗi trade khiến tradeFrequency luôn 1 khi có giao dịch; averageDailyTrades gán từ tradeFrequency. Drawdown chỉ trên equity sau đóng lệnh, không phản ánh mọi lỗ thả nổi. PF vô hạn khi không có lệnh lỗ bị đổi thành 0. Sharpe không dựa trên chuỗi lợi suất tài khoản theo thời gian.

Đường service validation thực tế dùng `runMonteCarloEngine` trong `validation-engines.ts`, có lấy mẫu ngẫu nhiên; không nên nhầm với helper Monte Carlo cũ trong backtest-engine. Tuy nhiên cả nghiên cứu và validation vẫn phụ thuộc simulator/baseline trên. Walk-forward đang so backtest tham số cố định giữa train/validation, chưa phải quy trình fit tham số trong từng train rồi freeze để chạy out-of-sample.

Ưu tiên: replay cùng Decision → Judge → Risk → Position Manager trên snapshot đúng thời điểm; entry sau thời điểm biết tín hiệu, mô phỏng phí/funding/slippage/gap, xử lý thứ tự chạm SL/TP thận trọng. Lưu kết quả baseline thực sự khác nhau, chuẩn hóa metrics theo thời gian. Benchmark AI cần dùng output AI lịch sử đã lưu hoặc forward shadow để tránh thông tin tương lai.

### 5. Scenario blueprint chưa thành kế hoạch thực thi đầy đủ

`decision.service.ts:849` truyền currentPrice, ATR, support và resistance đều undefined. Blueprint vì vậy có thể mô tả giữ hỗ trợ nhưng thiếu priceTarget/invalidationPrice. Probability được biến đổi từ confidence/directional agreement rồi chặn 45–85%, không phải xác suất calibrated. Chưa tìm thấy consumer của các trường scenario trigger/invalidation trong pipeline hoặc live-trading qua tìm kiếm mã nguồn.

Trade Plan riêng vẫn có thể tạo SL/TP; phát hiện này không có nghĩa mọi lệnh live không có bảo vệ. Cần nối scenario vào cùng snapshot/trade plan, trigger xác định và cơ chế tái đánh giá có kiểm soát; không tự đảo chiều chỉ vì câu mô tả kịch bản thay thế.

### 6. Net PnL cần đối soát đầy đủ chi phí

Ledger đang tính netPnl từ grossPnl cộng signed fees mở/đóng. Chưa thấy funding được phân bổ tại phép tính này. Khi đánh giá profitability cần đối soát funding, chi phí thực và dòng tiền tài khoản; tách DEMO/LIVE, partial close và toàn chu kỳ vị thế. Performance signal không thay thế được equity tài khoản thực.

## Kiểm chứng đã chạy

7 test files, 82 tests đạt: decision, data quality, Judge, Risk Engine, research engine, validation engines và performance calculator. Đây là kiểm thử logic với fixture, không phải kiểm định lợi nhuận.

Thử nghiệm độc lập gọi trực tiếp hàm nguồn bằng TypeScript transpilation, dùng 500 nến tổng hợp được đánh dấu SYNTHETIC:

- HYBRID_AI, PREVIOUS_AI_VERSION, PREVIOUS_STABLE_RELEASE tạo cùng 21 trade giống hệt nhau. Xác nhận benchmark không phân biệt phiên bản AI tại nhánh này.
- Blueprint LONG với confidence 90, agreement 100 và đầu vào giá thiếu trả probability 0.85 nhưng không có target/invalidation bằng giá.
- `evaluateDecision('LONG',100,102,0.1)` trả CORRECT, +1.9%. Với đường đi minh họa 100→98→102 và SL 99, lệnh đã thua trước khi giá kết thúc tăng. Xác nhận sự khác nhau giữa endpoint accuracy và outcome lệnh.
- Metrics từ dữ liệu tổng hợp cho annualizedReturn dưới -100% và Sharpe cực lớn về trị tuyệt đối khi độ lệch chuẩn gần 0, củng cố nhu cầu sửa định nghĩa và xử lý số học. Không diễn giải PnL tổng hợp này thành hiệu quả thị trường thực.

## Thử nghiệm production cần thực hiện khi kết nối được

1. Dùng snapshot hoặc transaction READ ONLY; ghi thời gian dữ liệu, commit deploy và phiên bản cấu hình. Không chạy replay qua endpoint có thể tạo lệnh.
2. Thống kê coverage: nến đóng/gap, tuổi dữ liệu từng agent, tỷ lệ DETERMINISTIC/LLM, lỗi/timeout, LONG/SHORT/WAIT và lý do Judge/Risk chặn.
3. Đối soát closed trades với fills và tài khoản; tách môi trường, chiến lược, symbol, regime, timeframe, phiên bản và các chu kỳ vị thế độc lập. Chỉ công bố win rate/PF khi có mẫu và provenance rõ.
4. Đo net expectancy/R, net PnL, drawdown mark-to-market, turnover và chi phí/funding; không cộng nhiều horizon của cùng tín hiệu thành nhiều trade độc lập.
5. Holdout theo thời gian và forward shadow; tránh các nhãn chồng lấn qua ranh giới train/test. So AI hiện tại, rules-only, bỏ từng analyst và no-trade dưới cùng execution/cost model.
6. Kiểm tra calibration theo outcome trade bằng reliability buckets/Brier; bootstrap theo block thời gian hoặc nhóm tín hiệu tương quan. Đo độ nhạy khi phí/slippage tăng và khi thay regime. Không chọn tham số bằng chính holdout.
7. Tiêu chuẩn go/no-go nên định trước: lợi thế sau chi phí có độ bất định chấp nhận được, drawdown trong giới hạn đã chọn, ổn định giữa cohort và không có lỗi bảo vệ vị thế. Cỡ mẫu phải tính theo mức nhiễu/độ tương quan, không chỉ đạt một số trade tùy ý.

## Thứ tự cải thiện đề xuất

1. Đo đúng trước: nhãn outcome, PnL/funding, backtest parity và metrics.
2. Sửa chất lượng bằng chứng: divergence/pivot, dữ liệu thiếu, confidence/EV và scenario gắn giá.
3. Chạy rules-only baseline và AI shadow cùng snapshot để đo phần lợi ích LLM thực sự thêm vào.
4. Chỉ mở rộng execution tự động khi kiểm chứng ngoài mẫu/forward đạt tiêu chuẩn đặt trước; giữ Risk và quyền đặt lệnh xác định.

Không có hệ thống hay trader bảo đảm có lợi nhuận ở mọi tình huống. Tham chiếu: [CFTC — AI Won’t Turn Trading Bots into Money Machines](https://www.cftc.gov/LearnAndProtect/AdvisoriesAndArticles/AITradingBots.html).
