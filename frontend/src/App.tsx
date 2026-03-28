import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AdminPage } from '@/components/AdminPage'
import { SearchForm } from '@/components/SearchForm'
import { SongPage } from '@/components/SongPage'

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<SearchForm />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/songs/:mb_recording_id" element={<SongPage />} />
      </Routes>
    </BrowserRouter>
  )
}
