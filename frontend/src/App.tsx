import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Home from './pages/Home'
import Room from './pages/Room'
import Admin from './pages/Admin'
import FinalLeaderboard from './pages/FinalLeaderboard'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"                       element={<Home />} />
        <Route path="/room/:roomId"           element={<Room />} />
        <Route path="/room/:roomId/final"     element={<FinalLeaderboard />} />
        <Route path="/admin"                  element={<Admin />} />
        <Route path="*"                       element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
