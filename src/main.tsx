import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// MapLibre 기본 CSS — index.css(Tailwind preflight)보다 먼저 불러야 .maplibregl-marker 가 absolute 로 고정되고
// 컨트롤/어트리뷰션 배치가 유지된다 (이게 빠지면 마커가 문서 흐름에 따라 캔버스 아래로 렌더됨).
import 'maplibre-gl/dist/maplibre-gl.css'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './hooks/useTheme.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
