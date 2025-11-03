import MapView from './components/MapView';

export default async function Home({  }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-zinc-950">
      <main className="flex min-h-screen w-full max-w-4xl flex-col items-center space-y-14 py-32 px-16 bg-zinc-50 dark:bg-zinc-950 sm:items-start">
        <h1 className="text-7xl font-bold">Certified.</h1>
        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <h2 className="text-2xl font-semibold">Boucheries, Restaurants, Fournisseurs... Ici tout est certifié.</h2>
          <p className="max-w-lg text-zinc-600 dark:text-zinc-400">
            Découvrez des établissements et fournisseurs de confiance, rigoureusement vérifiés pour garantir la qualité et la sécurité de vos achats.
          </p>
          <MapView/>
        </div>
      </main>
    </div>
  );
}
