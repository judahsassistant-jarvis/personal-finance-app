export default function ComingSoon({ page, sprint }) {
  return (
    <div className="max-w-xl mx-auto mt-12 p-8 bg-white rounded-lg shadow text-center">
      <div className="text-sm uppercase tracking-wide text-indigo-600 mb-2">{page}</div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Coming soon</h1>
      <p className="text-gray-500">
        This page lands in <span className="font-medium text-gray-700">Sprint {sprint}</span>.
      </p>
    </div>
  );
}
