import { Skeleton, TableCell, TableRow } from "@worth/ui"

interface TableSkeletonRowsProps {
  readonly cols: number
  readonly rows: number
}

export const TableSkeletonRows = ({ cols, rows }: TableSkeletonRowsProps) => (
  <>
    {Array.from({ length: rows }).map((_, r) => (
      <TableRow key={r}>
        {Array.from({ length: cols }).map((_, c) => (
          <TableCell key={c}>
            <Skeleton
              className={
                c === cols - 1 ? "ml-auto h-3 w-20" : "h-3 w-24"
              }
            />
          </TableCell>
        ))}
      </TableRow>
    ))}
  </>
)
