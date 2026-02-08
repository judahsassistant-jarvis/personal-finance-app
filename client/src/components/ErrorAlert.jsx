export default function ErrorAlert({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div className="bg-red-50 border border-red-200 rounded-md p-4 flex justify-between items-start">
      <div className="flex items-start">
        <span className="text-red-600 mr-2">⚠️</span>
        <p className="text-sm text-red-700">{message}</p>
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="text-red-400 hover:text-red-600 text-sm ml-4">✕</button>
      )}
    </div>
  );
}
