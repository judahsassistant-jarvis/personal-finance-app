import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card.jsx';
import { Badge } from './ui/badge.jsx';

export default function ComingSoon({ page, sprint }) {
  return (
    <div className="max-w-xl mx-auto mt-8">
      <Card>
        <CardHeader>
          <Badge variant="muted" className="w-fit">{page}</Badge>
          <CardTitle className="text-2xl mt-2">Coming soon</CardTitle>
          <CardDescription>
            Lands in Sprint {sprint}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The data layer is already wired through Redux and Firestore — this page is just waiting for its UI.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
