import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

// 按需注册，避免把整个 echarts 打进首屏（体积从 ~1.3MB 降到 ~400KB）
echarts.use([LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

/**
 * 极简 ECharts 包装：
 * - 用 ResizeObserver 自适应容器宽度（手机旋转、布局变化都能跟着变）
 * - option 变化时整体替换（notMerge=true），避免残留旧系列
 * - 卸载时 dispose，防止内存泄漏
 */
export default function EChart({ option, height = 240, className = '' }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const chart = echarts.init(containerRef.current, null, { renderer: 'canvas' });
    chartRef.current = chart;

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (chartRef.current && option) {
      chartRef.current.setOption(option, true);
    }
  }, [option]);

  return <div ref={containerRef} className={className} style={{ width: '100%', height }} />;
}
