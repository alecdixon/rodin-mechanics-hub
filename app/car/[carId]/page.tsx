import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ carId: string }>;
};

export default async function CarHomePage({ params }: Props) {
  const { carId } = await params;
  redirect(`/car/${carId}/job-list`);
}
