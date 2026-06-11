import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { RunsView } from './views/RunsView'
import { ToursView } from './views/ToursView'
import { TourDetailView } from './views/TourDetailView'
import { CreateTourView } from './views/CreateTourView'
import { ReferenceView } from './views/ReferenceView'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/runs" replace />} />
        <Route path="/runs" element={<RunsView />} />
        <Route path="/tours" element={<ToursView />} />
        <Route path="/tours/:id" element={<TourDetailView />} />
        <Route path="/create" element={<CreateTourView />} />
        <Route path="/reference" element={<ReferenceView />} />
        <Route path="*" element={<Navigate to="/runs" replace />} />
      </Route>
    </Routes>
  )
}
