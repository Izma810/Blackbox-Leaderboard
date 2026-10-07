import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Home            from './pages/Home'
import Join            from './pages/Join'
import Play            from './pages/Play'
import Admin           from './pages/Admin'
import FinalLeaderboard from './pages/FinalLeaderboard'
import { isLoggedIn }  from './lib/session'

function RequireAuth({ children }: { children: JSX.Element }) {
  return isLoggedIn() ? children : <Navigate to="/" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"      element={<Home />} />
        <Route path="/join"  element={<Join />} />
        <Route path="/play"  element={<RequireAuth><Play /></RequireAuth>} />
        <Route path="/final" element={<FinalLeaderboard />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*"      element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
