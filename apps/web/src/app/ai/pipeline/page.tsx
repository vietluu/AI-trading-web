"use client";

import Link from 'next/link';
import { usePipelineDashboard } from '@/hooks/ai/useAiFeature';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
import { useTranslation } from '@/lib/i18n/i18n-context';

export default function PipelinePage() {
  const { language } = useTranslation();
  const vi = language === 'vi';
  const health = usePipelineDashboard();
  const scope = useQuery({
    queryKey: ['pipeline-subscriptions'],
    queryFn: () => apiRequest<Array<{ symbol: string; provider: string; strategyIds: string[] }>>('/pipeline/subscriptions'),
    refetchInterval: 30_000,
  });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">{vi ? 'Theo dõi cơ hội giao dịch' : 'Trading opportunity monitoring'}</h1>
        <Link className="rounded border px-4 py-2" href="/ai/pipeline-runs">
          {vi ? 'Lịch sử phân tích' : 'Analysis history'}
        </Link>
      </div>
      <p className="text-muted-foreground">{vi
        ? 'Hệ thống phân tích khi có tin quan trọng hoặc biến động thị trường đạt điều kiện. Kết quả được dùng chung; mỗi tài khoản được kiểm tra chiến lược, vốn và rủi ro riêng trước khi xem xét vào lệnh.'
        : 'Important news and qualifying market moves trigger shared analysis. Strategy, capital and risk are checked separately for each account before considering an order.'}</p>
      <section className="grid gap-4 md:grid-cols-3">
        {[
          [vi ? 'Hệ thống' : 'System', health.data?.status ?? '…'],
          [vi ? 'Hàng đợi' : 'Queue', String(health.data?.queueDepth ?? '…')],
          [vi ? 'Lỗi liên tiếp' : 'Failure streak', String(health.data?.failureStreak ?? '…')],
        ].map(([label, value]) => <div className="rounded-lg border bg-card p-4" key={label}>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 text-xl font-semibold">{value}</p>
        </div>)}
      </section>
      <section className="space-y-4 rounded-lg border bg-card p-5">
        <h2 className="text-lg font-semibold">{vi ? 'Symbol đủ điều kiện theo dõi' : 'Eligible monitored symbols'}</h2>
        <p>{scope.data?.map((item) => `${item.symbol} (${item.provider})`).join(', ') || (vi ? 'Chưa có symbol đủ điều kiện.' : 'No eligible symbols yet.')}</p>
        <p className="text-sm text-muted-foreground">{vi
          ? 'Để được xem xét giao dịch, symbol cần thuộc một chiến lược đang bật và có kết nối sàn đã xác minh. Bạn không cần tạo lịch phân tích hoặc cấu hình AI.'
          : 'A symbol needs an active strategy and a verified exchange connection to be considered for trading. No analysis schedule or AI configuration is needed.'}</p>
        <div className="flex gap-4">
          <Link className="underline" href="/settings">{vi ? 'Chọn symbol' : 'Select symbols'}</Link>
          <Link className="underline" href="/ai/portfolio">{vi ? 'Quản lý chiến lược' : 'Manage strategies'}</Link>
        </div>
      </section>
      {(health.isError || scope.isError) && <p role="alert">{vi
        ? 'Không tải được trạng thái. Vui lòng thử lại.' : 'Unable to load status. Please try again.'}</p>}
    </div>
  );
}
