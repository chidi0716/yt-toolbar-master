// T04 共用控制元件的展示頁（只用於本機截圖檢查，不會打包進擴充功能）。
// 以 YouTube 2026-10 實測到的 --yt-sys-color-baseline--* 值模擬淺色與深色主題。
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { Button } from '@/components/controls/Button';
import { RangeSlider } from '@/components/controls/RangeSlider';
import { Select } from '@/components/controls/Select';
import { Switch } from '@/components/controls/Switch';
import { TimeInput } from '@/components/controls/TimeInput';
import { PanelError, PanelLoading } from '@/components/panels/PanelStatus';
import controlsCss from '@/components/controls/controls.css?inline';
import toolbarCss from '@/components/toolbar/toolbar.css?inline';
import { formatTime, validateRange } from '@/utils/time';

const style = document.createElement('style');
style.textContent = `${toolbarCss}\n${controlsCss}`;
document.head.append(style);

const DURATION = 245;

function Demo() {
  const [range, setRange] = useState<readonly [number, number]>([90, 225]);
  const [startText, setStartText] = useState(formatTime(90, true));
  const [endText, setEndText] = useState(formatTime(225, true));
  const [bitrate, setBitrate] = useState('192');
  const [sync, setSync] = useState(true);
  const check = validateRange(startText, endText, DURATION);
  return (
    <div class="ytm-panel" style={{ position: 'static', width: '420px' }}>
      <div class="ytm-panel-header">
        <h2 class="ytm-panel-title">Controls</h2>
      </div>
      <div class="ytm-panel-body" style={{ display: 'grid', gap: '16px' }}>
        <label style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span>MP3 bitrate</span>
          <Select
            label="MP3 bitrate"
            value={bitrate}
            onChange={setBitrate}
            options={['64', '128', '192', '256', '320'].map((v) => ({ value: v, label: `${v} kbps` }))}
          />
        </label>
        <div>
          <RangeSlider
            min={0}
            max={DURATION}
            value={range}
            startLabel="Start"
            endLabel="End"
            formatValue={(v) => formatTime(v)}
            onChange={(v) => {
              setRange(v);
              setStartText(formatTime(v[0], true));
              setEndText(formatTime(v[1], true));
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ytm-text-secondary)', fontSize: '12px' }}>
            <span>{formatTime(0)}</span>
            <span>{formatTime(DURATION)}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '16px' }}>
          <div>
            <TimeInput
              id="start"
              label="Start"
              value={range[0]}
              invalid={!!check.startError}
              onInput={(s, text) => {
                setStartText(text);
                if (s !== null) setRange([s, range[1]]);
              }}
            />
          </div>
          <div>
            <TimeInput
              id="end"
              label="End"
              value={range[1]}
              invalid={!!check.endError}
              errorId="end-error"
              onInput={(s, text) => {
                setEndText(text);
                if (s !== null) setRange([range[0], s]);
              }}
            />
            {check.endError && (
              <p id="end-error" class="ytm-field-error">
                {check.endError}
              </p>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <Switch label="Sync with player" checked={sync} onChange={setSync} />
          <span>Sync with player</span>
          <Switch label="Off" checked={false} onChange={() => {}} />
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span class="ytm-badge">4K</span>
          <span class="ytm-badge">2K</span>
          <span class="ytm-badge">HD</span>
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="secondary">Pin panel</Button>
          <Button variant="primary" disabled={!check.valid}>
            Download
          </Button>
        </div>
        <PanelLoading />
        <PanelError onRetry={() => {}} />
      </div>
    </div>
  );
}

render(<Demo />, document.getElementById('app')!);
