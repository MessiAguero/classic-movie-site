import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import Layout from './components/Layout';
import AdminPage from './pages/AdminPage';
import AnalysesPage from './pages/AnalysesPage';
import AnalysisDetailPage from './pages/AnalysisDetailPage';
import ContactPage from './pages/ContactPage';
import GalleryPage from './pages/GalleryPage';
import HistoryPage from './pages/HistoryPage';
import HomePage from './pages/HomePage';
import MoviePage from './pages/MoviePage';
import PosterPage from './pages/PosterPage';
import QuotesPage from './pages/QuotesPage';

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/daily/:id" element={<MoviePage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/gallery" element={<GalleryPage />} />
            <Route path="/gallery/:id" element={<PosterPage />} />
            <Route path="/quotes" element={<QuotesPage />} />
            <Route path="/analyses" element={<AnalysesPage />} />
            <Route path="/analyses/:id" element={<AnalysisDetailPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
