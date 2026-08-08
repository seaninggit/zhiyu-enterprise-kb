import { getD1 } from "../../../db";
import { fail, ok, requestId } from "../../../lib/api";

export async function GET(request: Request) {
  const rid = requestId(request);
  try {
    const db = getD1();
    const url = new URL(request.url);
    const treeId = Number(url.searchParams.get("id") || 0);

    if (treeId) {
      const tree = await db.prepare("SELECT * FROM decision_trees WHERE id=? AND is_active=1").bind(treeId).first();
      const nodes = await db.prepare("SELECT * FROM decision_nodes WHERE tree_id=? ORDER BY id").bind(treeId).all();
      const roots = nodes.results.filter((n: any) => !n.parent_id);
      return ok({ tree, rootNodes: roots, allNodes: nodes.results }, rid);
    }

    const trees = await db.prepare("SELECT * FROM decision_trees WHERE is_active=1 ORDER BY category, id").all();
    return ok({ trees: trees.results }, rid);
  } catch (error) { return fail(error, rid); }
}
